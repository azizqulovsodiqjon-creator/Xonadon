"""
Manual card-to-card payment: the buyer sends the money to the owner's own
bank card and the owner confirms it (Django admin -> Uz payments -> action
"Pul tushdi - tasdiqlash"). Only then is the listing / upgrade / balance
top-up finished - the same code path Payme and Click use after their callback.

The card details come from settings (TRANSFER_CARD_* env vars), so the card
number never lives in the repository.
"""
from django.conf import settings
from django.http import Http404
from django.shortcuts import render
from django.views.decorators.http import require_http_methods

from .models import UzPayment

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


@require_http_methods(['GET', 'POST'])
def transfer_page(request, session_id):
    payment = UzPayment.objects.filter(provider='transfer', session_id=session_id).first()
    if not payment:
        raise Http404()
    if request.method == 'POST' and not payment.paid:
        payment.payer_note = request.POST.get('payer_note', '').strip()[:100]
        payment.save(update_fields=['payer_note'])
    return render(request, 'transfer.html', {
        'payment': payment,
        'what': _what(payment),
        'amount': f'{payment.amount_uzs:,}'.replace(',', ' '),
        'card': _card_groups(settings.TRANSFER_CARD_NUMBER),
        'holder': settings.TRANSFER_CARD_HOLDER,
        'bank': settings.TRANSFER_CARD_BANK,
        'return_url': f'/?post_payment=success&session_id={payment.session_id}'
                      if payment.kind == 'listing' else f'/?balance_payment=success&session_id={payment.session_id}',
        'sent': request.method == 'POST' or bool(payment.payer_note),
    })
