"""
Payme and Click - real so'm payments with Uzbek cards (Uzcard/Humo).

Both work the same way from the site's point of view: we create a
pending row (the very same PendingListingPayment / PendingBalanceTopup
the Stripe flow uses) plus a UzPayment order, send the user to the
provider's payment page, and the provider calls us back server-to-server
to check the order and to report the money as taken. Only that callback
finishes the purchase (creates the listing, applies the upgrade or
credits the balance) - the user's return to the site just shows the
result.

  Payme: Merchant API (JSON-RPC) at /api/payments/payme/
         https://developer.help.paycom.uz/metody-merchant-api/
  Click: SHOP-API Prepare/Complete at /api/payments/click/
         https://docs.click.uz/click-api-request/
"""
import base64
import hashlib
import hmac
import json
import math
import secrets
import time
import urllib.parse

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import UzPayment, PaymeTransaction

PROVIDERS = ('payme', 'click')

# Payme cancels an unperformed transaction after 12 hours.
PAYME_TIMEOUT_MS = 12 * 60 * 60 * 1000


def configured(provider):
    if provider == 'payme':
        return bool(settings.PAYME_MERCHANT_ID and settings.PAYME_KEY)
    if provider == 'click':
        return bool(settings.CLICK_SERVICE_ID and settings.CLICK_MERCHANT_ID and settings.CLICK_SECRET_KEY)
    return False


def requested_provider(request):
    """'payme' / 'click' when the client asked to pay with one of them,
    else None (= the Stripe card flow)."""
    provider = str(request.data.get('provider') or '').strip()
    return provider if provider in PROVIDERS else None


def usd_cents_to_uzs(cents, rate):
    """Top-ups are entered in dollars; charge the so'm equivalent at the
    Central Bank rate, rounded up to a whole 100 so'm."""
    return int(math.ceil(cents / 100 * rate / 100) * 100)


def start(request, provider, kind, amount_uzs, return_param, make_pending):
    """Create the order and return the provider's payment page URL.
    make_pending(session_id) creates and returns the pending row."""
    session_id = f'{provider}-{secrets.token_hex(8)}'
    pending = make_pending(session_id)
    payment = UzPayment.objects.create(
        provider=provider, kind=kind, session_id=session_id, amount_uzs=amount_uzs,
        pending_listing=pending if kind == 'listing' else None,
        pending_topup=pending if kind == 'topup' else None,
    )
    origin = request.build_absolute_uri('/').rstrip('/')
    return_url = f'{origin}/?{return_param}=success&session_id={session_id}'
    if provider == 'payme':
        base = 'https://checkout.test.paycom.uz' if settings.PAYME_TEST_MODE else 'https://checkout.paycom.uz'
        params = f'm={settings.PAYME_MERCHANT_ID};ac.order_id={payment.pk};a={amount_uzs * 100};l=uz;c={return_url}'
        return base + '/' + base64.b64encode(params.encode('utf-8')).decode('ascii')
    return 'https://my.click.uz/services/pay?' + urllib.parse.urlencode({
        'service_id': settings.CLICK_SERVICE_ID,
        'merchant_id': settings.CLICK_MERCHANT_ID,
        'amount': amount_uzs,
        'transaction_param': payment.pk,
        'return_url': return_url,
    })


def _finish(payment, request=None):
    """The money is in - do what was paid for, exactly once."""
    from . import views
    if payment.kind == 'topup':
        views._finalize_balance_topup(payment.pending_topup)
    else:
        views._finalize_pending_payment(payment.pending_listing, request)
    payment.paid = True
    payment.paid_at = timezone.now()
    payment.save(update_fields=['paid', 'paid_at'])


# =========================================================
# PAYME - Merchant API
# =========================================================

class PaymeError(Exception):
    def __init__(self, code, uz, ru=None, en=None, data=None):
        super().__init__(uz)
        self.code = code
        self.message = {'uz': uz, 'ru': ru or uz, 'en': en or uz}
        self.data = data


def _now_ms():
    return int(time.time() * 1000)


def _payme_auth_ok(request):
    header = request.META.get('HTTP_AUTHORIZATION', '')
    if not settings.PAYME_KEY or not header.startswith('Basic '):
        return False
    try:
        decoded = base64.b64decode(header[6:]).decode('utf-8')
    except Exception:
        return False
    _login, _, password = decoded.partition(':')
    return hmac.compare_digest(password, settings.PAYME_KEY)


def _payme_order(params):
    """The UzPayment the request's account.order_id points at, checked
    against the amount - raises the matching Payme error otherwise."""
    order_id = str((params.get('account') or {}).get('order_id', '')).strip()
    payment = UzPayment.objects.filter(provider='payme', pk=order_id).first() if order_id.isdigit() else None
    if not payment:
        raise PaymeError(-31050, 'Buyurtma topilmadi', 'Заказ не найден', 'Order not found', 'order_id')
    if payment.paid:
        raise PaymeError(-31051, "Buyurtma allaqachon to'langan", 'Заказ уже оплачен', 'Order already paid', 'order_id')
    try:
        amount = int(params.get('amount'))
    except (TypeError, ValueError):
        amount = -1
    if amount != payment.amount_uzs * 100:
        raise PaymeError(-31001, "Noto'g'ri summa", 'Неверная сумма', 'Incorrect amount')
    return payment


def _payme_tx(params, lock=False):
    qs = PaymeTransaction.objects.select_related('payment')
    if lock:
        qs = qs.select_for_update()
    tx = qs.filter(payme_id=str(params.get('id', ''))).first()
    if not tx:
        raise PaymeError(-31003, 'Tranzaksiya topilmadi', 'Транзакция не найдена', 'Transaction not found')
    return tx


def _payme_cancel_expired(tx):
    tx.state = PaymeTransaction.STATE_CANCELLED
    tx.reason = 4  # timeout
    tx.cancel_time = _now_ms()
    tx.save(update_fields=['state', 'reason', 'cancel_time'])


def _payme_check_perform(params, request):
    _payme_order(params)
    return {'allow': True}


def _payme_create(params, request):
    with transaction.atomic():
        tx = PaymeTransaction.objects.select_for_update().filter(payme_id=str(params.get('id', ''))).first()
        if tx:
            if tx.state != PaymeTransaction.STATE_CREATED:
                raise PaymeError(-31008, "Amalni bajarib bo'lmaydi", 'Невозможно выполнить операцию', 'Unable to perform operation')
            if _now_ms() - tx.create_time > PAYME_TIMEOUT_MS:
                _payme_cancel_expired(tx)
                raise PaymeError(-31008, "Tranzaksiya muddati o'tgan", 'Истек срок транзакции', 'Transaction expired')
            return {'create_time': tx.create_time, 'transaction': str(tx.pk), 'state': tx.state}
        payment = _payme_order(params)
        busy = payment.payme_transactions.filter(state=PaymeTransaction.STATE_CREATED).exists()
        if busy:
            raise PaymeError(-31052, "Buyurtma boshqa to'lov kutmoqda", 'Заказ ожидает другую оплату', 'Order is awaiting another payment', 'order_id')
        tx = PaymeTransaction.objects.create(
            payme_id=str(params['id']), payment=payment, payme_time=int(params.get('time') or 0),
            amount_tiyin=int(params['amount']), create_time=_now_ms(),
        )
        return {'create_time': tx.create_time, 'transaction': str(tx.pk), 'state': tx.state}


def _payme_perform(params, request):
    with transaction.atomic():
        tx = _payme_tx(params, lock=True)
        if tx.state == PaymeTransaction.STATE_PERFORMED:
            return {'transaction': str(tx.pk), 'perform_time': tx.perform_time, 'state': tx.state}
        if tx.state != PaymeTransaction.STATE_CREATED:
            raise PaymeError(-31008, "Amalni bajarib bo'lmaydi", 'Невозможно выполнить операцию', 'Unable to perform operation')
        if _now_ms() - tx.create_time > PAYME_TIMEOUT_MS:
            _payme_cancel_expired(tx)
            raise PaymeError(-31008, "Tranzaksiya muddati o'tgan", 'Истек срок транзакции', 'Transaction expired')
        try:
            _finish(tx.payment, request)
        except Exception as exc:
            print(f'[payme] finishing order {tx.payment_id} failed: {exc}')
            raise PaymeError(-31008, "Buyurtmani bajarib bo'lmadi", 'Не удалось выполнить заказ', 'Could not fulfil the order')
        tx.state = PaymeTransaction.STATE_PERFORMED
        tx.perform_time = _now_ms()
        tx.save(update_fields=['state', 'perform_time'])
        return {'transaction': str(tx.pk), 'perform_time': tx.perform_time, 'state': tx.state}


def _payme_cancel(params, request):
    with transaction.atomic():
        tx = _payme_tx(params, lock=True)
        if tx.state == PaymeTransaction.STATE_CREATED:
            tx.state = PaymeTransaction.STATE_CANCELLED
            tx.reason = params.get('reason')
            tx.cancel_time = _now_ms()
            tx.save(update_fields=['state', 'reason', 'cancel_time'])
        elif tx.state == PaymeTransaction.STATE_PERFORMED:
            # The listing is already live / the balance already credited -
            # a refund is handled by hand, not by undoing it here.
            raise PaymeError(-31007, "Xizmat ko'rsatilgan, bekor qilib bo'lmaydi",
                             'Услуга оказана, отмена невозможна', 'Service already provided, cannot cancel')
        return {'transaction': str(tx.pk), 'cancel_time': tx.cancel_time, 'state': tx.state}


def _payme_tx_info(tx):
    return {
        'create_time': tx.create_time, 'perform_time': tx.perform_time, 'cancel_time': tx.cancel_time,
        'transaction': str(tx.pk), 'state': tx.state, 'reason': tx.reason,
    }


def _payme_check(params, request):
    return _payme_tx_info(_payme_tx(params))


def _payme_statement(params, request):
    txs = PaymeTransaction.objects.filter(
        payme_time__gte=int(params.get('from') or 0), payme_time__lte=int(params.get('to') or 0),
    ).order_by('payme_time')
    return {'transactions': [dict(_payme_tx_info(tx), id=tx.payme_id, time=tx.payme_time,
                                  amount=tx.amount_tiyin, account={'order_id': str(tx.payment_id)})
                             for tx in txs]}


PAYME_METHODS = {
    'CheckPerformTransaction': _payme_check_perform,
    'CreateTransaction': _payme_create,
    'PerformTransaction': _payme_perform,
    'CancelTransaction': _payme_cancel,
    'CheckTransaction': _payme_check,
    'GetStatement': _payme_statement,
}


def _payme_error_response(rid, err):
    body = {'code': err.code, 'message': err.message}
    if err.data:
        body['data'] = err.data
    return JsonResponse({'jsonrpc': '2.0', 'id': rid, 'error': body})


@csrf_exempt
def payme_endpoint(request):
    # Payme always expects HTTP 200 with a JSON-RPC result/error body.
    if request.method != 'POST':
        return _payme_error_response(None, PaymeError(-32300, "So'rov POST bo'lishi kerak"))
    try:
        body = json.loads(request.body.decode('utf-8'))
    except Exception:
        return _payme_error_response(None, PaymeError(-32700, "JSON xato"))
    rid = body.get('id')
    if not _payme_auth_ok(request):
        return _payme_error_response(rid, PaymeError(-32504, 'Ruxsat yo\'q', 'Недостаточно привилегий', 'Insufficient privilege'))
    handler = PAYME_METHODS.get(body.get('method'))
    if not handler:
        return _payme_error_response(rid, PaymeError(-32601, 'Metod topilmadi', 'Метод не найден', 'Method not found'))
    try:
        result = handler(body.get('params') or {}, request)
    except PaymeError as err:
        return _payme_error_response(rid, err)
    except (KeyError, TypeError, ValueError):
        return _payme_error_response(rid, PaymeError(-32600, "So'rov noto'g'ri", 'Неверный запрос', 'Invalid request'))
    return JsonResponse({'jsonrpc': '2.0', 'id': rid, 'result': result})


# =========================================================
# CLICK - SHOP-API (Prepare = action 0, Complete = action 1)
# =========================================================

def _click_reply(data, error, note, **extra):
    body = {
        'click_trans_id': data.get('click_trans_id'),
        'merchant_trans_id': data.get('merchant_trans_id'),
        'error': error,
        'error_note': note,
    }
    body.update(extra)
    return JsonResponse(body)


@csrf_exempt
def click_endpoint(request):
    data = request.POST
    try:
        action = int(data.get('action'))
    except (TypeError, ValueError):
        return _click_reply(data, -3, 'Action not found')
    if action not in (0, 1):
        return _click_reply(data, -3, 'Action not found')
    needed = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'sign_time', 'sign_string']
    if action == 1:
        needed.append('merchant_prepare_id')
    if any(not data.get(k) for k in needed) or not configured('click'):
        return _click_reply(data, -8, 'Error in request from click')

    expected = hashlib.md5((
        data['click_trans_id'] + data['service_id'] + settings.CLICK_SECRET_KEY + data['merchant_trans_id'] +
        (data['merchant_prepare_id'] if action == 1 else '') + data['amount'] + str(action) + data['sign_time']
    ).encode('utf-8')).hexdigest()
    if not hmac.compare_digest(expected, data['sign_string']) or data['service_id'] != str(settings.CLICK_SERVICE_ID):
        return _click_reply(data, -1, 'SIGN CHECK FAILED!')

    order_id = data['merchant_trans_id']
    with transaction.atomic():
        payment = (UzPayment.objects.select_for_update().filter(provider='click', pk=order_id).first()
                   if order_id.isdigit() else None)
        if not payment:
            return _click_reply(data, -5, 'User does not exist')
        try:
            amount_ok = abs(float(data['amount']) - payment.amount_uzs) < 0.01
        except ValueError:
            amount_ok = False
        if not amount_ok:
            return _click_reply(data, -2, 'Incorrect parameter amount')
        if payment.paid:
            return _click_reply(data, -4, 'Already paid')
        if payment.click_cancelled:
            return _click_reply(data, -9, 'Transaction cancelled')

        if action == 0:
            payment.click_trans_id = data['click_trans_id']
            payment.click_paydoc_id = data.get('click_paydoc_id', '')
            payment.save(update_fields=['click_trans_id', 'click_paydoc_id'])
            return _click_reply(data, 0, 'Success', merchant_prepare_id=payment.pk)

        if data['merchant_prepare_id'] != str(payment.pk) or data['click_trans_id'] != payment.click_trans_id:
            return _click_reply(data, -6, 'Transaction does not exist')
        try:
            click_error = int(data.get('error') or 0)
        except ValueError:
            click_error = 0
        if click_error < 0:
            # Click couldn't take the money - the order is dead.
            payment.click_cancelled = True
            payment.save(update_fields=['click_cancelled'])
            return _click_reply(data, -9, 'Transaction cancelled')
        try:
            with transaction.atomic():
                _finish(payment, request)
        except Exception as exc:
            print(f'[click] finishing order {payment.pk} failed: {exc}')
            return _click_reply(data, -7, 'Failed to update user')
        return _click_reply(data, 0, 'Success', merchant_confirm_id=payment.pk)
