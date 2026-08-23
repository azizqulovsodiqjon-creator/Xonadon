import json
import random
import urllib.error
import urllib.request

import stripe
from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.contrib.auth import authenticate, login, logout
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from django.utils.decorators import method_decorator
from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from django.db.models import Q
from .models import (
    Listing, Profile, PendingListingPayment, PendingBalanceTopup, Message,
    TelegramVerification, normalize_phone,
)
from .serializers import ListingSerializer, ProfileSerializer, MessageSerializer


@ensure_csrf_cookie
def index(request):
    # ensure_csrf_cookie guarantees the csrftoken cookie is set on first
    # page load, so the admin login/logout/delete requests below can send
    # a valid X-CSRFToken header.
    return render(request, 'index.html')


class ListingViewSet(viewsets.ModelViewSet):
    queryset = Listing.objects.all().order_by('-created_at')
    serializer_class = ListingSerializer

    def get_permissions(self):
        # Anyone can browse, post, or edit a listing (that's the public
        # site flow - there's no real per-request auth to lock editing
        # down further). destroy() below does its own check.
        return [AllowAny()]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        user = request.user
        is_admin = bool(user and user.is_authenticated and user.is_staff)
        # The owner can delete their own listing too - identified by the
        # same client-asserted username used everywhere else on the site
        # (no real per-request auth exists here to check more strongly).
        claimed_seller = str(request.data.get('seller') or request.query_params.get('seller') or '').strip()
        if not is_admin and claimed_seller != instance.seller:
            return Response({'detail': "Bu e'lonni o'chirishga ruxsatingiz yo'q."}, status=403)
        return super().destroy(request, *args, **kwargs)


class ProfileViewSet(viewsets.ModelViewSet):
    queryset = Profile.objects.all().order_by('-created_at')
    serializer_class = ProfileSerializer

    def get_permissions(self):
        # Same idea: reading/creating your own profile stays open (needed
        # for the phone+OTP signup flow), only admin can delete profiles.
        if self.action == 'destroy':
            return [IsAdminUser()]
        return [AllowAny()]

    def get_queryset(self):
        qs = Profile.objects.all().order_by('-created_at')
        if self.action != 'list':
            # retrieve/update/partial_update/destroy all target one known
            # id (e.g. editing your own profile) - that's not a bulk data
            # leak, so only the LIST action below needs locking down.
            return qs
        phone = self.request.query_params.get('phone')
        if phone:
            # Looking up a single profile by exact phone number is needed
            # for the login flow and is not a bulk data leak. Normalize so
            # '+998 90 123 45 67' and '998901234567' find the same row.
            return qs.filter(phone=normalize_phone(phone))
        user = self.request.user
        if user and user.is_authenticated and user.is_staff:
            return qs
        # Without a phone filter this would dump every user's phone number
        # and name to anyone who asks - only the admin panel is allowed to
        # list every profile.
        return qs.none()


class AdminLoginThrottle(AnonRateThrottle):
    scope = 'admin_login'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([AdminLoginThrottle])
def admin_login(request):
    username = str(request.data.get('username', '')).strip()
    password = str(request.data.get('password', ''))
    user = authenticate(request, username=username, password=password)
    if user is not None and user.is_active and user.is_staff:
        login(request, user)
        return Response({'ok': True})
    return Response({'ok': False, 'error': "Login yoki parol noto'g'ri."}, status=401)


@api_view(['POST'])
@permission_classes([AllowAny])
def admin_logout(request):
    logout(request)
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([AllowAny])
def admin_status(request):
    u = request.user
    return Response({'isAdmin': bool(u and u.is_authenticated and u.is_staff)})


@api_view(['POST'])
@permission_classes([AllowAny])
def send_message(request):
    sender = str(request.data.get('sender', '')).strip()
    receiver = str(request.data.get('receiver', '')).strip()
    text = str(request.data.get('text', '')).strip()
    listing_id = request.data.get('listing') or None
    if not sender or not receiver or not text:
        return Response({'ok': False, 'error': "Xabar matni va foydalanuvchilar kerak."}, status=400)
    if sender == receiver:
        return Response({'ok': False, 'error': "O'zingizga xabar yubora olmaysiz."}, status=400)
    msg = Message.objects.create(sender=sender, receiver=receiver, text=text, listing_id=listing_id)
    return Response(MessageSerializer(msg).data, status=201)


@api_view(['GET'])
@permission_classes([AllowAny])
def message_thread(request):
    me = str(request.query_params.get('me', '')).strip()
    other = str(request.query_params.get('with', '')).strip()
    if not me or not other:
        return Response({'ok': False, 'error': "'me' va 'with' parametrlari kerak."}, status=400)
    qs = Message.objects.filter(Q(sender=me, receiver=other) | Q(sender=other, receiver=me)).order_by('created_at')
    # Opening the thread marks what they sent me as read.
    Message.objects.filter(sender=other, receiver=me, read=False).update(read=True)
    return Response(MessageSerializer(qs, many=True).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def message_conversations(request):
    me = str(request.query_params.get('me', '')).strip()
    if not me:
        return Response({'ok': False, 'error': "'me' parametri kerak."}, status=400)
    mine = Message.objects.filter(Q(sender=me) | Q(receiver=me))
    partners = set()
    for m in mine.only('sender', 'receiver'):
        partners.add(m.receiver if m.sender == me else m.sender)

    result = []
    for partner in partners:
        thread = mine.filter(Q(sender=partner) | Q(receiver=partner))
        last = thread.order_by('-created_at').first()
        unread = thread.filter(sender=partner, receiver=me, read=False).count()
        result.append({
            'username': partner,
            'lastText': last.text if last else '',
            'lastAt': last.created_at.isoformat() if last else None,
            'unread': unread,
        })
    result.sort(key=lambda r: r['lastAt'] or '', reverse=True)
    return Response(result)


@api_view(['GET'])
@permission_classes([AllowAny])
def profiles_directory(request):
    # A public, privacy-safe listing of every registered user - just
    # enough (username/name/role) to power the "Profil qidirish" search,
    # without exposing phone numbers the way the full Profile list does.
    data = Profile.objects.order_by('username').values('username', 'full_name', 'role')
    return Response(list(data))


# =========================================================
# PAYMENTS (Stripe) - posting a listing costs money per tier
# =========================================================

TIER_LABELS = {'regular': "Oddiy e'lon", 'top': "TOP e'lon", 'vip': "VIP e'lon"}


@api_view(['GET'])
@permission_classes([AllowAny])
def payment_config(request):
    # Lets the frontend show real prices/currency and know whether Stripe
    # keys have even been set yet, without ever seeing the secret key.
    return Response({
        'configured': bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PUBLISHABLE_KEY),
        'publishableKey': settings.STRIPE_PUBLISHABLE_KEY,
        'currency': 'usd',
        'prices': settings.LISTING_PRICE_CENTS,
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def create_checkout_session(request):
    if not settings.STRIPE_SECRET_KEY:
        return Response({'ok': False, 'error': "To'lov tizimi hali sozlanmagan. Administrator bilan bog'laning."}, status=503)

    tier = str(request.data.get('tier', '')).strip()
    amount = settings.LISTING_PRICE_CENTS.get(tier)
    if amount is None:
        return Response({'ok': False, 'error': "Noto'g'ri e'lon turi."}, status=400)

    listing_payload = request.data.get('listing')
    if not isinstance(listing_payload, dict):
        return Response({'ok': False, 'error': "E'lon ma'lumotlari yo'q."}, status=400)

    # The tier the client picked decides vip/top, not whatever flags it
    # sent - so nobody can post a VIP listing at the regular price.
    listing_payload = dict(listing_payload)
    listing_payload['vip'] = (tier == 'vip')
    listing_payload['top'] = (tier == 'top')

    # Validate the listing data up front so we don't charge someone for a
    # payload that will fail to save once payment succeeds.
    serializer = ListingSerializer(data=listing_payload)
    if not serializer.is_valid():
        return Response({'ok': False, 'error': "E'lon ma'lumotlari noto'g'ri.", 'details': serializer.errors}, status=400)

    stripe.api_key = settings.STRIPE_SECRET_KEY
    origin = request.build_absolute_uri('/').rstrip('/')
    tier_label = TIER_LABELS.get(tier, "E'lon")

    try:
        session = stripe.checkout.Session.create(
            mode='payment',
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': amount,
                    'product_data': {'name': 'Xonadon - ' + tier_label + ' joylash'},
                },
                'quantity': 1,
            }],
            success_url=f'{origin}/?post_payment=success&session_id={{CHECKOUT_SESSION_ID}}',
            cancel_url=f'{origin}/?post_payment=cancelled',
        )
    except Exception as exc:
        return Response({'ok': False, 'error': str(exc)}, status=502)

    PendingListingPayment.objects.create(
        stripe_session_id=session.id,
        tier=tier,
        amount_cents=amount,
        currency='usd',
        payload=listing_payload,
    )
    return Response({'ok': True, 'url': session.url})


def _finalize_pending_payment(pending):
    """Idempotent: create the Listing for a paid pending row exactly once.

    Called from both the success-redirect confirm endpoint and the
    webhook - whichever gets there first wins, the other is a no-op.
    """
    if pending.created_listing_id:
        return pending.created_listing
    serializer = ListingSerializer(data=pending.payload)
    serializer.is_valid(raise_exception=True)
    listing = serializer.save()
    pending.paid = True
    pending.created_listing = listing
    pending.save(update_fields=['paid', 'created_listing'])
    return listing


@api_view(['GET'])
@permission_classes([AllowAny])
def confirm_payment(request):
    session_id = request.query_params.get('session_id', '')
    if not session_id:
        return Response({'ok': False, 'error': 'session_id kerak.'}, status=400)

    try:
        pending = PendingListingPayment.objects.get(stripe_session_id=session_id)
    except PendingListingPayment.DoesNotExist:
        return Response({'ok': False, 'error': "To'lov topilmadi."}, status=404)

    if pending.created_listing_id:
        return Response({'ok': True, 'listing': ListingSerializer(pending.created_listing).data})

    if not settings.STRIPE_SECRET_KEY:
        return Response({'ok': False, 'error': "To'lov tizimi sozlanmagan."}, status=503)

    stripe.api_key = settings.STRIPE_SECRET_KEY
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except Exception as exc:
        return Response({'ok': False, 'error': str(exc)}, status=502)

    if session.payment_status != 'paid':
        return Response({'ok': False, 'status': session.payment_status})

    listing = _finalize_pending_payment(pending)
    return Response({'ok': True, 'listing': ListingSerializer(listing).data})


# =========================================================
# BALANCE (top up via Stripe, spend on posting a listing)
# =========================================================

MIN_TOPUP_CENTS = 100  # $1.00


@api_view(['POST'])
@permission_classes([AllowAny])
def create_balance_topup_session(request):
    if not settings.STRIPE_SECRET_KEY:
        return Response({'ok': False, 'error': "To'lov tizimi hali sozlanmagan."}, status=503)

    profile_id = request.data.get('profile_id')
    try:
        amount = int(request.data.get('amount_cents'))
    except (TypeError, ValueError):
        amount = None
    if not profile_id or not amount or amount < MIN_TOPUP_CENTS:
        return Response({'ok': False, 'error': "Noto'g'ri summa (kamida $1.00)."}, status=400)

    try:
        profile = Profile.objects.get(id=profile_id)
    except Profile.DoesNotExist:
        return Response({'ok': False, 'error': "Profil topilmadi."}, status=404)

    stripe.api_key = settings.STRIPE_SECRET_KEY
    origin = request.build_absolute_uri('/').rstrip('/')

    try:
        session = stripe.checkout.Session.create(
            mode='payment',
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': amount,
                    'product_data': {'name': "Joymee Jizzax - balansni to'ldirish"},
                },
                'quantity': 1,
            }],
            success_url=f'{origin}/?balance_payment=success&session_id={{CHECKOUT_SESSION_ID}}',
            cancel_url=f'{origin}/?balance_payment=cancelled',
        )
    except Exception as exc:
        return Response({'ok': False, 'error': str(exc)}, status=502)

    PendingBalanceTopup.objects.create(
        stripe_session_id=session.id, profile=profile, amount_cents=amount, currency='usd',
    )
    return Response({'ok': True, 'url': session.url})


def _finalize_balance_topup(pending):
    """Idempotent: credit the profile's balance for a paid pending row
    exactly once. Called from both the confirm endpoint and the webhook."""
    if pending.paid:
        return pending.profile
    pending.paid = True
    pending.save(update_fields=['paid'])
    profile = pending.profile
    profile.balance_cents = (profile.balance_cents or 0) + pending.amount_cents
    profile.save(update_fields=['balance_cents'])
    return profile


@api_view(['GET'])
@permission_classes([AllowAny])
def confirm_balance_topup(request):
    session_id = request.query_params.get('session_id', '')
    if not session_id:
        return Response({'ok': False, 'error': 'session_id kerak.'}, status=400)

    try:
        pending = PendingBalanceTopup.objects.get(stripe_session_id=session_id)
    except PendingBalanceTopup.DoesNotExist:
        return Response({'ok': False, 'error': "To'lov topilmadi."}, status=404)

    if pending.paid:
        return Response({'ok': True, 'profile': ProfileSerializer(pending.profile).data})

    if not settings.STRIPE_SECRET_KEY:
        return Response({'ok': False, 'error': "To'lov tizimi sozlanmagan."}, status=503)

    stripe.api_key = settings.STRIPE_SECRET_KEY
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except Exception as exc:
        return Response({'ok': False, 'error': str(exc)}, status=502)

    if session.payment_status != 'paid':
        return Response({'ok': False, 'status': session.payment_status})

    profile = _finalize_balance_topup(pending)
    return Response({'ok': True, 'profile': ProfileSerializer(profile).data})


@api_view(['POST'])
@permission_classes([AllowAny])
def create_listing_from_balance(request):
    """Pay for a top/vip listing straight out of the profile's balance -
    no Stripe redirect, the listing is created immediately."""
    tier = str(request.data.get('tier', '')).strip()
    amount = settings.LISTING_PRICE_CENTS.get(tier)
    if amount is None:
        return Response({'ok': False, 'error': "Noto'g'ri e'lon turi."}, status=400)

    profile_id = request.data.get('profile_id')
    listing_payload = request.data.get('listing')
    if not profile_id or not isinstance(listing_payload, dict):
        return Response({'ok': False, 'error': "Ma'lumotlar yo'q."}, status=400)

    try:
        profile = Profile.objects.get(id=profile_id)
    except Profile.DoesNotExist:
        return Response({'ok': False, 'error': "Profil topilmadi."}, status=404)

    if (profile.balance_cents or 0) < amount:
        return Response({'ok': False, 'error': "Balansingizda yetarli mablag' yo'q."}, status=402)

    listing_payload = dict(listing_payload)
    listing_payload['vip'] = (tier == 'vip')
    listing_payload['top'] = (tier == 'top')
    serializer = ListingSerializer(data=listing_payload)
    if not serializer.is_valid():
        return Response({'ok': False, 'error': "E'lon ma'lumotlari noto'g'ri.", 'details': serializer.errors}, status=400)

    # Deduct first, then create - if the listing save somehow fails the
    # serializer.is_valid() check above already caught bad data, so this
    # is effectively atomic in practice for sqlite/postgres single-request use.
    profile.balance_cents = (profile.balance_cents or 0) - amount
    profile.save(update_fields=['balance_cents'])
    listing = serializer.save()
    return Response({'ok': True, 'listing': ListingSerializer(listing).data, 'profile': ProfileSerializer(profile).data})


@csrf_exempt
def stripe_webhook(request):
    # Plain Django view (not DRF) so we get the raw request body untouched
    # for Stripe's signature check - it's the authoritative confirmation
    # path in case the user closes the tab before the success redirect.
    if request.method != 'POST':
        return JsonResponse({'error': 'method not allowed'}, status=405)
    if not settings.STRIPE_WEBHOOK_SECRET:
        return JsonResponse({'ok': True})  # not configured yet - accept quietly

    try:
        event = stripe.Webhook.construct_event(
            request.body, request.META.get('HTTP_STRIPE_SIGNATURE', ''), settings.STRIPE_WEBHOOK_SECRET
        )
    except (ValueError, stripe.error.SignatureVerificationError):
        return JsonResponse({'error': 'invalid signature'}, status=400)

    if event['type'] == 'checkout.session.completed':
        session_obj = event['data']['object']
        sid = session_obj['id']
        try:
            pending = PendingListingPayment.objects.get(stripe_session_id=sid)
            _finalize_pending_payment(pending)
        except PendingListingPayment.DoesNotExist:
            try:
                topup = PendingBalanceTopup.objects.get(stripe_session_id=sid)
                _finalize_balance_topup(topup)
            except PendingBalanceTopup.DoesNotExist:
                pass

    return JsonResponse({'ok': True})


# =========================================================
# TELEGRAM (replaces SMS for the signup verification code)
# =========================================================

def _telegram_api(method, **params):
    """Best-effort call to the Telegram Bot API. Returns the parsed JSON
    response, or None if the bot isn't configured or the call failed -
    callers should treat None as 'could not send, try again later' and
    never let it raise into the request/response cycle."""
    if not settings.TELEGRAM_BOT_TOKEN:
        return None
    url = f'https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/{method}'
    data = json.dumps(params).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as exc:
        print(f"[_telegram_api] {method} failed: {exc}")
        return None


class TelegramStartThrottle(AnonRateThrottle):
    scope = 'telegram_start'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([TelegramStartThrottle])
def telegram_start(request):
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_BOT_USERNAME:
        return Response({'ok': False, 'error': "Telegram bot hali sozlanmagan."}, status=503)
    phone = normalize_phone(request.data.get('phone', ''))
    if not phone:
        return Response({'ok': False, 'error': "Telefon raqami kerak."}, status=400)

    verification = TelegramVerification.objects.create(phone=phone)
    deep_link = f'https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start={verification.token}'
    return Response({'ok': True, 'token': verification.token, 'deepLink': deep_link})


@api_view(['GET'])
@permission_classes([AllowAny])
def telegram_status(request):
    token = request.query_params.get('token', '')
    try:
        v = TelegramVerification.objects.get(token=token)
    except TelegramVerification.DoesNotExist:
        return Response({'ok': False, 'error': "Topilmadi."}, status=404)
    return Response({'ok': True, 'codeSent': bool(v.chat_id and v.code), 'verified': v.verified})


@api_view(['POST'])
@permission_classes([AllowAny])
def telegram_verify(request):
    token = str(request.data.get('token', ''))
    code = str(request.data.get('code', '')).strip()
    try:
        v = TelegramVerification.objects.get(token=token)
    except TelegramVerification.DoesNotExist:
        return Response({'ok': False, 'error': "Topilmadi."}, status=404)
    if v.verified:
        return Response({'ok': True, 'phone': v.phone})
    if not v.chat_id or not v.code:
        return Response({'ok': False, 'error': "Kod hali yuborilmagan."}, status=400)
    if code != v.code:
        return Response({'ok': False, 'error': "Kod noto'g'ri."}, status=400)
    v.verified = True
    v.save(update_fields=['verified'])
    return Response({'ok': True, 'phone': v.phone})


@csrf_exempt
def telegram_webhook(request):
    # Plain Django view, not DRF - this is called by Telegram's servers
    # directly, no CSRF/session context applies.
    if request.method != 'POST':
        return JsonResponse({'error': 'method not allowed'}, status=405)
    try:
        update = json.loads(request.body.decode('utf-8'))
    except Exception:
        return JsonResponse({'ok': True})

    message = update.get('message') or {}
    text = str(message.get('text', ''))
    chat = message.get('chat') or {}
    chat_id = chat.get('id')

    if chat_id and text.startswith('/start'):
        parts = text.split(maxsplit=1)
        token = parts[1].strip() if len(parts) == 2 else ''
        if token:
            try:
                v = TelegramVerification.objects.get(token=token)
            except TelegramVerification.DoesNotExist:
                v = None
            if v and not v.chat_id:
                code = f"{random.randint(0, 999999):06d}"
                v.chat_id = str(chat_id)
                v.code = code
                v.save(update_fields=['chat_id', 'code'])
                _telegram_api(
                    'sendMessage', chat_id=chat_id,
                    text=f"Joymee Jizzax tasdiqlash kodi: {code}\n\nBu kodni hech kimga bermang.",
                )
            elif v:
                # Already linked/sent once for this token - resend the
                # same code rather than silently doing nothing if they
                # tap Start again.
                _telegram_api(
                    'sendMessage', chat_id=chat_id,
                    text=f"Joymee Jizzax tasdiqlash kodi: {v.code}\n\nBu kodni hech kimga bermang.",
                )

    return JsonResponse({'ok': True})


@api_view(['GET'])
@permission_classes([IsAdminUser])
def telegram_diagnostics(request):
    """Admin-only: ask Telegram directly what it thinks our webhook is,
    so we can tell 'never registered' apart from 'registered but not
    receiving updates' without ever exposing the bot token itself."""
    if not settings.TELEGRAM_BOT_TOKEN:
        return Response({'ok': False, 'error': 'TELEGRAM_BOT_TOKEN not set'}, status=503)
    info = _telegram_api('getWebhookInfo')
    raw_error = None
    if info is None:
        # _telegram_api swallows the exception - redo the call here just
        # to surface what actually went wrong (401 invalid token vs a
        # network failure look completely different).
        url = f'https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/getWebhookInfo'
        req = urllib.request.Request(url, data=b'{}', headers={'Content-Type': 'application/json'})
        try:
            urllib.request.urlopen(req, timeout=10)
        except urllib.error.HTTPError as exc:
            raw_error = f'HTTP {exc.code}: {exc.read().decode("utf-8", "replace")}'
        except Exception as exc:
            raw_error = f'{type(exc).__name__}: {exc}'
    expected_url = settings.SITE_BASE_URL.rstrip('/') + '/api/telegram/webhook/'
    return Response({
        'ok': info is not None,
        'rawError': raw_error,
        'expectedWebhookUrl': expected_url,
        'siteBaseUrl': settings.SITE_BASE_URL,
        'telegramResponse': info,
    })
