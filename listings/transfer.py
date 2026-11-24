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
from django.http import Http404, HttpResponseForbidden
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.http import require_http_methods

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


@require_http_methods(['GET', 'POST'])
def transfer_page(request, session_id):
    payment = UzPayment.objects.filter(provider='transfer', session_id=session_id).first()
    if not payment:
        raise Http404()
    error = ''
    if request.method == 'POST' and not payment.paid:
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
