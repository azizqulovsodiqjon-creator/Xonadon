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
from .models import Listing, Profile, PendingListingPayment, Message
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
            # for the login flow and is not a bulk data leak.
            return qs.filter(phone=phone)
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
        try:
            pending = PendingListingPayment.objects.get(stripe_session_id=session_obj['id'])
            _finalize_pending_payment(pending)
        except PendingListingPayment.DoesNotExist:
            pass

    return JsonResponse({'ok': True})
