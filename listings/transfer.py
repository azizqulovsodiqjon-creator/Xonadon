"""
Manual card-to-card payment: the buyer sends the money to the owner's own
bank card, uploads a photo/screenshot of the bank receipt ("chek"), and the
owner confirms it (Django admin -> Uz payments -> action "Pul tushdi -
tasdiqlash"). Only then is the listing / upgrade / balance top-up finished -
the same code path Payme and Click use after their callback. Nothing is
posted before the admin confirms.

The card details come from settings (TRANSFER_CARD_* env vars), so the card
number never lives in the repository.
"""
from django.conf import settings
from django.db import transaction
from django.http import Http404, HttpResponseForbidden
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.http import require_http_methods
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import Listing, UzPayment

TIER_NAMES = {'top': "TOP e'lon", 'vip': "VIP e'lon"}


def _card_groups(number):
    digits = ''.join(ch for ch in str(number) if ch.isdigit())
    return ' '.join(digits[i:i + 4] for i in range(0, len(digits), 4))


def _what(payment):
    if payment.kind == 'topup':
        return "Balansni to'ldirish"
    pending = payment.pending_listing
    if pending and pending.payload.get('_upgrade_listing_id'):
        return TIER_NAMES.get(pending.tier, pending.tier) + " ga o'tkazish"
    return TIER_NAMES.get(pending.tier, "E'lon") + ' joylash' if pending else "E'lon"


def _payer_username(payment):
    """Whose order this is: the seller of the new/upgraded listing, or the
    profile topping up their balance."""
    if payment.kind == 'topup':
        return payment.pending_topup.profile.username if payment.pending_topup else ''
    pending = payment.pending_listing
    if not pending:
        return ''
    upgrade_id = pending.payload.get('_upgrade_listing_id')
    if upgrade_id:
        listing = Listing.objects.filter(pk=upgrade_id).first()
        return listing.seller if listing else ''
    return pending.payload.get('seller', '')


def _save_receipt(payment, uploaded):
    """Compress and store the receipt image. Returns an error message for
    the payer, or '' when it was saved."""
    from .views import MAX_UPLOAD_BYTES, _compress_to_data_url
    if uploaded.size > MAX_UPLOAD_BYTES:
        return f"Rasm hajmi juda katta (maksimum {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)."
    try:
        payment.receipt = _compress_to_data_url(uploaded)
    except Exception:
        return "Rasmni o'qib bo'lmadi. Chekning skrinshotini (JPG yoki PNG) yuklang."
    payment.receipt_uploaded_at = timezone.now()
    return ''


def _title(payment):
    """The listing this payment is for, as shown to the admin."""
    pending = payment.pending_listing
    if payment.kind == 'topup' or not pending:
        return ''
    upgrade_id = pending.payload.get('_upgrade_listing_id')
    if upgrade_id:
        listing = Listing.objects.filter(pk=upgrade_id).first()
        return listing.title if listing else ''
    return str(pending.payload.get('title', ''))


def _notify_payer(payment, text):
    from .models import Message
    payer = _payer_username(payment)
    if payer:
        Message.objects.create(sender=settings.SUPPORT_USERNAME, receiver=payer, text=text)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_payments(request):
    """Card transfers waiting for the admin (/panel/ "Tasdiqlash" tab):
    not confirmed and not rejected yet, the ones with a receipt first."""
    waiting = (UzPayment.objects.filter(provider='transfer', paid=False, rejected_at__isnull=True)
               .select_related('pending_listing', 'pending_topup__profile')
               .order_by('-receipt_uploaded_at', '-created_at')[:100])
    rows = sorted(waiting, key=lambda p: not p.receipt)  # with a receipt first, newest first
    return Response([{
        'id': p.id,
        'what': _what(p),
        'title': _title(p),
        'amountUzs': p.amount_uzs,
        'payer': _payer_username(p),
        'note': p.payer_note,
        'receipt': p.receipt,
        'receiptAt': p.receipt_uploaded_at.isoformat() if p.receipt_uploaded_at else None,
        'createdAt': p.created_at.isoformat(),
    } for p in rows])


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_payment_decide(request, payment_id):
    """approve: the money is in - post the listing / apply the upgrade /
    credit the balance. reject: drop it from the queue, nothing is posted.
    Either way the payer gets a message from the support account."""
    from . import uzpay
    decision = request.data.get('decision')
    if decision not in ('approve', 'reject'):
        return Response({'ok': False, 'error': "decision 'approve' yoki 'reject' bo'lishi kerak."}, status=400)
    with transaction.atomic():
        payment = (UzPayment.objects.select_for_update()
                   .filter(pk=payment_id, provider='transfer', paid=False, rejected_at__isnull=True).first())
        if payment is None:
            return Response({'ok': False, 'error': "To'lov topilmadi yoki allaqachon ko'rib chiqilgan."}, status=404)
        what = _what(payment)
        if decision == 'reject':
            payment.rejected_at = timezone.now()
            payment.save(update_fields=['rejected_at'])
            _notify_payer(payment, f"{what} uchun to'lovingiz tasdiqlanmadi: pul tushmagan yoki chek noto'g'ri. "
                                   "Savolingiz bo'lsa, shu yerga yozing.")
            return Response({'ok': True, 'status': 'rejected'})
        if not payment.receipt:
            return Response({'ok': False, 'error': "Chek hali yuborilmagan - tasdiqlab bo'lmaydi."}, status=400)
        uzpay._finish(payment, request._request)
    _notify_payer(payment, f"{what} uchun to'lovingiz tasdiqlandi. Rahmat!")
    return Response({'ok': True, 'status': 'approved'})


@require_http_methods(['GET', 'POST'])
def transfer_page(request, session_id):
    payment = UzPayment.objects.filter(provider='transfer', session_id=session_id).first()
    if not payment:
        raise Http404()
    error = ''
    if request.method == 'POST' and not payment.paid and not payment.rejected_at:
        # Only the person who placed the order may send its receipt.
        from .views import _session_profile
        me = _session_profile(request)
        if me is None or me.username != _payer_username(payment):
            return HttpResponseForbidden("Bu to'lov sizga tegishli emas. Saytga o'z profilingiz bilan kiring.")
        uploaded = request.FILES.get('receipt')
        if not uploaded and not payment.receipt:
            error = "To'lov chekining rasmini yuklang."
        else:
            if uploaded:
                error = _save_receipt(payment, uploaded)
            if not error:
                payment.payer_note = request.POST.get('payer_note', '').strip()[:100]
                payment.save(update_fields=['payer_note', 'receipt', 'receipt_uploaded_at'])
    return render(request, 'transfer.html', {
        'payment': payment,
        'what': _what(payment),
        'amount': f'{payment.amount_uzs:,}'.replace(',', ' '),
        'card': _card_groups(settings.TRANSFER_CARD_NUMBER),
        'holder': settings.TRANSFER_CARD_HOLDER,
        'bank': settings.TRANSFER_CARD_BANK,
        'return_url': f'/?post_payment=success&session_id={payment.session_id}'
                      if payment.kind == 'listing' else f'/?balance_payment=success&session_id={payment.session_id}',
        'sent': bool(payment.receipt) and not error,
        'error': error,
    }, status=400 if error else 200)
