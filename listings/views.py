import datetime
import json
import os
import random
import re
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
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from django.db.models import Q, F, Sum, Count
from .models import (
    Listing, ListingImage, Like, Profile, PendingListingPayment, PendingBalanceTopup,
    Message, TelegramVerification, TIER_LIFECYCLE, normalize_phone, SoldListingRecord,
)
from .serializers import ListingSerializer, ProfileSerializer, MessageSerializer


def sweep_expired_listings():
    """
    Steps every listing through its tier lifecycle (see TIER_LIFECYCLE):
    once the current stage's day count has elapsed, either drop it to
    the next stage (vip->top->regular) or, at the final stage, delete it
    outright. No background worker exists on this host, so this is
    called opportunistically from cheap, frequently-hit endpoints
    (the homepage and the listings list) instead - correctness doesn't
    depend on exact timing, only on it running at least every few
    minutes, which the keep-alive ping already guarantees.
    """
    from django.utils import timezone
    now = timezone.now()
    for listing in Listing.objects.all():
        if listing.sold:
            # mark_sold() deletes a listing on the spot now, so this
            # should never actually be hit - kept as a safety net in case
            # a listing ever ends up sold=True without being deleted.
            listing.delete()
            continue

        stages = TIER_LIFECYCLE.get(listing.posted_tier, TIER_LIFECYCLE['regular'])
        stage = listing.current_stage()
        stage_index = next((i for i, (s, _d) in enumerate(stages) if s == stage), None)
        if stage_index is None:
            continue
        _stage_name, duration_days = stages[stage_index]
        if now < listing.stage_started_at + datetime.timedelta(days=duration_days):
            continue  # this stage hasn't run its course yet
        if stage_index + 1 < len(stages):
            next_stage, _ = stages[stage_index + 1]
            listing.vip = (next_stage == 'vip')
            listing.top = (next_stage == 'top')
            listing.stage_started_at = now
            listing.save(update_fields=['vip', 'top', 'stage_started_at'])
        else:
            listing.delete()


@ensure_csrf_cookie
def index(request):
    # ensure_csrf_cookie guarantees the csrftoken cookie is set on first
    # page load, so the admin login/logout/delete requests below can send
    # a valid X-CSRFToken header. Also doubles as the periodic trigger for
    # sweep_expired_listings() - the keep-alive ping hits this every few
    # minutes, which is all the timing precision that needs.
    try:
        sweep_expired_listings()
    except Exception as exc:
        print(f'[sweep_expired_listings] failed: {exc}')
    return render(request, 'index.html')


def _link_images_to_listing(image_ids, listing):
    """Attach previously-uploaded (still unlinked) ListingImage rows to a
    listing that was just created. Ignores ids that don't exist or are
    already linked to something else - never lets a bad id list break
    listing creation."""
    if not image_ids:
        return
    try:
        ids = [int(i) for i in image_ids][:10]
    except (TypeError, ValueError):
        return
    ListingImage.objects.filter(id__in=ids, listing__isnull=True).update(listing=listing)


class ListingViewSet(viewsets.ModelViewSet):
    queryset = Listing.objects.all().order_by('-created_at')
    serializer_class = ListingSerializer

    def get_queryset(self):
        if self.action == 'list':
            try:
                sweep_expired_listings()
            except Exception as exc:
                print(f'[sweep_expired_listings] failed: {exc}')
        return super().get_queryset()

    def get_permissions(self):
        if self.action == 'mark_sold':
            return [IsAdminUser()]
        # Anyone can browse, post, edit, view, or like a listing (that's
        # the public site flow - there's no real per-request auth to lock
        # editing down further). destroy() below does its own check.
        return [AllowAny()]

    def create(self, request, *args, **kwargs):
        # Free ('regular') listings are created directly here (paid tiers
        # go through Stripe/balance and get linked in
        # _finalize_pending_payment instead) - photos were already
        # uploaded separately before this call, so just attach them now.
        response = super().create(request, *args, **kwargs)
        if response.status_code == 201:
            listing = Listing.objects.get(pk=response.data['id'])
            _link_images_to_listing(request.data.get('image_ids'), listing)
            response.data = ListingSerializer(listing).data
        return response

    def update(self, request, *args, **kwargs):
        # Covers both PUT and PATCH (partial_update() delegates here) -
        # editing a listing to add NEW photos uploads them the same
        # pre-upload way as creation, so the same image_ids linking step
        # is needed here too, or newly-added photos on an edit would
        # upload successfully but never actually attach to the listing.
        response = super().update(request, *args, **kwargs)
        if response.status_code == 200:
            listing = Listing.objects.get(pk=response.data['id'])
            _link_images_to_listing(request.data.get('image_ids'), listing)
            response.data = ListingSerializer(listing).data
        return response

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

    @action(detail=True, methods=['post'], permission_classes=[AllowAny])
    def view_hit(self, request, pk=None):
        # Every open counts, even repeats from the same visitor - there's
        # no real visitor identity to dedupe against here, and that's
        # explicitly what was asked for.
        Listing.objects.filter(pk=pk).update(views_count=F('views_count') + 1)
        listing = self.get_object()
        return Response({'ok': True, 'views_count': listing.views_count})

    @action(detail=True, methods=['post'], permission_classes=[AllowAny])
    def like(self, request, pk=None):
        username = str(request.data.get('username', '')).strip()
        if not username:
            return Response({'ok': False, 'error': "Foydalanuvchi aniqlanmadi."}, status=400)
        listing = self.get_object()
        _like, created = Like.objects.get_or_create(listing=listing, username=username)
        if created:
            Listing.objects.filter(pk=listing.pk).update(likes_count=F('likes_count') + 1)
            listing.refresh_from_db(fields=['likes_count'])
        return Response({'ok': True, 'likes_count': listing.likes_count, 'alreadyLiked': not created})

    @action(detail=True, methods=['post'], permission_classes=[IsAdminUser], url_path='mark-sold')
    def mark_sold(self, request, pk=None):
        sold = bool(request.data.get('sold', True))
        listing = self.get_object()

        if not sold:
            listing.sold = False
            listing.save(update_fields=['sold'])
            return Response({'ok': True, 'sold': False})

        # Sold listings (any tier - regular/top/vip) are removed
        # immediately, no grace period. Snapshot it first so admin stats
        # can still show sold-listing history/totals afterward.
        SoldListingRecord.objects.create(
            title=listing.title, price=listing.price, seller=listing.seller,
            district=listing.district, tier=listing.posted_tier,
            original_listing_id=listing.id,
        )
        listing.delete()
        return Response({'ok': True, 'sold': True, 'deleted': True})


MAX_UPLOAD_IMAGES = 10
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8MB per file, before compression


def _compress_to_data_url(uploaded_file, max_dim=None, quality=None):
    from io import BytesIO
    from PIL import Image

    # Storage is paid for (Postgres, not free disk), so keep these fairly
    # aggressive by default - 900px/q70 is still perfectly sharp for a
    # listing photo viewed on a phone/browser, at a fraction of the size.
    # Tunable without a redeploy via env vars if the tradeoff ever needs
    # revisiting.
    max_dim = max_dim or int(os.environ.get('IMAGE_MAX_DIM', '900'))
    quality = quality or int(os.environ.get('IMAGE_QUALITY', '70'))

    img = Image.open(uploaded_file)
    img = img.convert('RGB')  # normalizes any format/mode, drops alpha
    img.thumbnail((max_dim, max_dim))
    buf = BytesIO()
    img.save(buf, format='JPEG', quality=quality, optimize=True)
    import base64
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return f'data:image/jpeg;base64,{b64}'


class ListingImageThrottle(AnonRateThrottle):
    scope = 'listing_images'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([ListingImageThrottle])
def upload_listing_images(request):
    """
    Uploads photos BEFORE the listing they belong to necessarily exists
    yet (paid tiers only create the real Listing once Stripe confirms,
    well after the file picker's in-browser File objects are gone).
    Compresses + stores each as a data: URI directly in Postgres (not
    local disk - Render wipes that on every deploy) and hands back their
    ids, which the client folds into the listing payload as `image_ids`
    for whichever endpoint actually creates the Listing to link up.
    """
    files = request.FILES.getlist('images')[:MAX_UPLOAD_IMAGES]
    if not files:
        return Response({'ok': False, 'error': "Rasm topilmadi."}, status=400)

    created_ids = []
    for f in files:
        if f.size > MAX_UPLOAD_BYTES:
            continue
        try:
            data_url = _compress_to_data_url(f)
        except Exception as exc:
            print(f'[upload_listing_images] skipped unreadable file: {exc}')
            continue
        img = ListingImage.objects.create(listing=None, image=data_url)
        created_ids.append(img.id)

    if not created_ids:
        return Response({'ok': False, 'error': "Hech qanday rasm yuklanmadi."}, status=400)
    return Response({'ok': True, 'imageIds': created_ids})


class ProfileViewSet(viewsets.ModelViewSet):
    queryset = Profile.objects.all().order_by('-created_at')
    serializer_class = ProfileSerializer

    def update(self, request, *args, **kwargs):
        # username is the de-facto identity every Listing/Message/Like
        # is stored against (there's no real per-request auth here to
        # link them by id instead) - so renaming it must cascade
        # everywhere the OLD username was recorded, or a renamed user's
        # existing listings and message threads silently orphan: buyers
        # keep messaging the old name, which no longer matches anyone,
        # so the messages just vanish for the (now renamed) seller.
        instance = self.get_object()
        old_username = instance.username
        response = super().update(request, *args, **kwargs)
        if response.status_code == 200:
            new_username = response.data.get('username')
            if new_username and old_username and new_username != old_username:
                Listing.objects.filter(seller=old_username).update(seller=new_username)
                Message.objects.filter(sender=old_username).update(sender=new_username)
                Message.objects.filter(receiver=old_username).update(receiver=new_username)
                Like.objects.filter(username=old_username).update(username=new_username)
        return response

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
        return Response({'ok': True, 'isSuperAdmin': user.is_superuser})
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
    is_admin = bool(u and u.is_authenticated and u.is_staff)
    return Response({
        'isAdmin': is_admin,
        # The full admin (988912) manages listings/profiles; the stats
        # account (admin/statistika123) is staff but not superuser, so it
        # only ever sees the read-only statistics dashboard.
        'isSuperAdmin': bool(is_admin and u.is_superuser),
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def my_sold_count(request):
    # Sold listings are deleted the instant they're marked sold, so a
    # seller's own "nechta uyim sotilgan" count can't come from the
    # listings list anymore - it comes from the sold-snapshot history.
    seller = str(request.GET.get('seller', '')).strip()
    if not seller:
        return Response({'soldCount': 0})
    return Response({'soldCount': SoldListingRecord.objects.filter(seller=seller).count()})


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_stats(request):
    from django.utils import timezone
    import datetime

    now = timezone.now()
    day_ago = now - datetime.timedelta(days=1)
    week_ago = now - datetime.timedelta(days=7)
    month_ago = now - datetime.timedelta(days=30)

    def revenue_since(since):
        total = PendingListingPayment.objects.filter(paid=True, created_at__gte=since).aggregate(s=Sum('amount_cents'))['s'] or 0
        total += PendingBalanceTopup.objects.filter(paid=True, created_at__gte=since).aggregate(s=Sum('amount_cents'))['s'] or 0
        return total

    by_seller = (
        Listing.objects.values('seller')
        .annotate(
            listing_count=Count('id'),
            total_views=Sum('views_count'),
            total_likes=Sum('likes_count'),
        )
        .order_by('-listing_count')
    )

    # Sold listings are deleted from Listing the instant they're marked
    # sold (see mark_sold), so history comes from the snapshot taken
    # right before deletion instead.
    sold_qs = SoldListingRecord.objects.all().order_by('-created_at')
    sold_detail = [
        {'id': r.original_listing_id, 'title': r.title, 'price': r.price, 'seller': r.seller, 'district': r.district}
        for r in sold_qs
    ]
    # price is a free-text field (mixes '$', so'm, spaces) - best-effort
    # numeric total by stripping everything but digits, same approach the
    # frontend's own priceNum() helper uses for filtering.
    sold_total_number = sum(int(re.sub(r'\D', '', r.price) or 0) for r in sold_qs)

    # Revenue broken down by paid tier (top/vip), all-time - so the admin
    # can see not just "how many TOP/VIP were bought" but how much money
    # each tier actually brought in.
    tier_breakdown = {}
    for tier_key in ('top', 'vip'):
        qs = PendingListingPayment.objects.filter(paid=True, tier=tier_key)
        tier_breakdown[tier_key] = {
            'count': qs.count(),
            'revenueCents': qs.aggregate(s=Sum('amount_cents'))['s'] or 0,
        }

    return Response({
        'sellers': list(by_seller),
        'totalListings': Listing.objects.count(),
        'soldListings': sold_qs.count(),
        'soldListingsDetail': sold_detail,
        'soldListingsTotalPriceNumber': sold_total_number,
        'paidListingsBought': PendingListingPayment.objects.filter(paid=True).count(),
        'tierBreakdown': tier_breakdown,
        'revenueCentsToday': revenue_since(day_ago),
        'revenueCentsWeek': revenue_since(week_ago),
        'revenueCentsMonth': revenue_since(month_ago),
        'revenueCentsAllTime': revenue_since(datetime.datetime(2000, 1, 1, tzinfo=datetime.timezone.utc)),
    })


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


@api_view(['GET'])
@permission_classes([AllowAny])
def my_likes(request):
    """Which listing ids this username has liked - drives both the
    detail page's already-liked state and the 'liked listings' view,
    and (being server-tracked, not local storage) survives a reload or
    logging back in on another device."""
    username = str(request.query_params.get('username', '')).strip()
    if not username:
        return Response({'ok': False, 'error': "Foydalanuvchi aniqlanmadi."}, status=400)
    listing_ids = list(Like.objects.filter(username=username).values_list('listing_id', flat=True))
    return Response({'ok': True, 'listingIds': listing_ids})


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
        # How many listings are CURRENTLY sitting in each tier right now
        # (not lifetime totals) - shown on the tier-picker so a poster can
        # see "N ta uy hozir TOP'da" the way the reference pricing page does.
        'activeCounts': {
            'regular': Listing.objects.filter(vip=False, top=False).count(),
            'top': Listing.objects.filter(top=True).count(),
            'vip': Listing.objects.filter(vip=True).count(),
        },
        # Day-by-day lifecycle each tier steps through before expiring,
        # for the "necha kun turadi" text under each price.
        'lifecycle': TIER_LIFECYCLE,
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
    _link_images_to_listing(pending.payload.get('image_ids'), listing)
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
                    'product_data': {'name': "Jizzax UyJoy - balansni to'ldirish"},
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
    _link_images_to_listing(listing_payload.get('image_ids'), listing)
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
                    text=f"Jizzax UyJoy tasdiqlash kodi: {code}\n\nBu kodni hech kimga bermang.",
                )
            elif v:
                # Already linked/sent once for this token - resend the
                # same code rather than silently doing nothing if they
                # tap Start again.
                _telegram_api(
                    'sendMessage', chat_id=chat_id,
                    text=f"Jizzax UyJoy tasdiqlash kodi: {v.code}\n\nBu kodni hech kimga bermang.",
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
