import datetime
import json
import os
import random
import re
import urllib.error
import urllib.parse
import urllib.request

import stripe
from django.conf import settings
from django.http import JsonResponse, HttpResponse
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
    Listing, ListingImage, VoiceNote, Like, Profile, PendingListingPayment, PendingBalanceTopup,
    Message, TelegramVerification, TIER_LIFECYCLE, normalize_phone, SoldListingRecord,
    VerificationRequest, PaymentEvent, TierDiscount,
)
from .serializers import ListingSerializer, ProfileSerializer, MessageSerializer

try:
    # iPhones save photos as HEIC/HEIF by default, which stock Pillow
    # can't open - without this, every HEIC upload silently failed
    # (caught in _compress_to_data_url's caller, logged, skipped) and
    # the listing would end up with fewer/no photos with no clear error
    # shown to the user. This registers a Pillow plugin so Image.open()
    # in _compress_to_data_url() below just handles .heic/.heif files
    # transparently, same as jpg/png.
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass


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
    return render(request, 'index.html', {'google_client_id': settings.GOOGLE_CLIENT_ID})


def robots_txt(request):
    # '/panel/' is the hidden admin-login entry point (same SPA page as
    # '/', just auto-opens the login modal) - not something that should
    # ever show up in search results, so it's kept out of the crawl.
    lines = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /panel/',
        'Sitemap: https://xonadon.onrender.com/sitemap.xml',
    ]
    return HttpResponse('\n'.join(lines), content_type='text/plain')


def sitemap_xml(request):
    # Listings themselves have no server-rendered URL of their own (the
    # whole site is a client-side SPA - opening a listing just toggles a
    # div, the address bar never changes), so there's only one real page
    # for a crawler to index right now: the homepage itself.
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        '  <url>\n'
        '    <loc>https://xonadon.onrender.com/</loc>\n'
        '    <changefreq>daily</changefreq>\n'
        '    <priority>1.0</priority>\n'
        '  </url>\n'
        '</urlset>\n'
    )
    return HttpResponse(xml, content_type='application/xml')


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


def _link_voice_note_to_listing(voice_note_id, listing):
    """Same idea as _link_images_to_listing, but for the (at most one)
    VoiceNote recorded while posting - it's created unlinked before the
    real Listing necessarily exists, then attached here."""
    if not voice_note_id:
        return
    try:
        vn_id = int(voice_note_id)
    except (TypeError, ValueError):
        return
    # A listing can only have one (OneToOneField) - if they re-recorded
    # while editing, drop the old row instead of hitting a uniqueness
    # error trying to attach a second one.
    VoiceNote.objects.filter(listing=listing).exclude(id=vn_id).delete()
    VoiceNote.objects.filter(id=vn_id, listing__isnull=True).update(listing=listing)


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
            _link_voice_note_to_listing(request.data.get('voice_note_id'), listing)
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
            _link_voice_note_to_listing(request.data.get('voice_note_id'), listing)
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

    TIER_ORDER = {'regular': 0, 'top': 1, 'vip': 2}

    def _validate_upgrade(self, listing, tier):
        """403/400 Response if this upgrade isn't allowed, else None."""
        amount = settings.LISTING_PRICE_CENTS.get(tier)
        if amount is None or self.TIER_ORDER.get(tier, -1) <= self.TIER_ORDER.get(listing.current_stage(), 99):
            return Response({'ok': False, 'error': "Bu turga o'tkazib bo'lmaydi."}, status=400)
        return None

    @action(detail=True, methods=['post'], permission_classes=[AllowAny], url_path='upgrade-tier/checkout')
    def upgrade_tier_checkout(self, request, pk=None):
        """Stripe Checkout redirect to bump an EXISTING listing to a
        higher paid tier (oddiy->top/vip, top->vip) - same per-tier price
        as posting fresh, no discount for already being live. Finishing
        reuses confirm_payment/the webhook exactly like a brand new paid
        post - _finalize_pending_payment tells this case apart by the
        _upgrade_listing_id marker in the pending row's payload."""
        if not settings.STRIPE_SECRET_KEY:
            return Response({'ok': False, 'error': "To'lov tizimi hali sozlanmagan."}, status=503)
        listing = self.get_object()
        claimed_seller = str(request.data.get('seller') or '').strip()
        if not claimed_seller or claimed_seller != listing.seller:
            return Response({'ok': False, 'error': "Bu e'lon sizga tegishli emas."}, status=403)
        tier = str(request.data.get('tier', '')).strip()
        bad = self._validate_upgrade(listing, tier)
        if bad:
            return bad
        amount = settings.LISTING_PRICE_CENTS[tier]

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
                        'product_data': {'name': 'Xonadon - ' + tier_label + " ga o'tkazish"},
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
            payload={'_upgrade_listing_id': listing.id},
        )
        return Response({'ok': True, 'url': session.url})

    @action(detail=True, methods=['post'], permission_classes=[AllowAny], url_path='upgrade-tier/balance')
    def upgrade_tier_balance(self, request, pk=None):
        """Same upgrade as upgrade_tier_checkout, paid straight out of the
        profile's balance - applies immediately, no Stripe redirect."""
        listing = self.get_object()
        claimed_seller = str(request.data.get('seller') or '').strip()
        if not claimed_seller or claimed_seller != listing.seller:
            return Response({'ok': False, 'error': "Bu e'lon sizga tegishli emas."}, status=403)
        tier = str(request.data.get('tier', '')).strip()
        bad = self._validate_upgrade(listing, tier)
        if bad:
            return bad
        amount = settings.LISTING_PRICE_CENTS[tier]

        try:
            profile = Profile.objects.get(id=request.data.get('profile_id'))
        except Profile.DoesNotExist:
            return Response({'ok': False, 'error': "Profil topilmadi."}, status=404)
        if (profile.balance_cents or 0) < amount:
            return Response({'ok': False, 'error': "Balansingizda yetarli mablag' yo'q."}, status=402)

        profile.balance_cents = profile.balance_cents - amount
        profile.save(update_fields=['balance_cents'])
        listing = _apply_tier_upgrade(listing, tier)
        _record_payment_event(listing.seller, 'tier_upgrade', tier, amount)
        return Response({'ok': True, 'listing': ListingSerializer(listing).data, 'profile': ProfileSerializer(profile).data})

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
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB per file, before compression - modern phone cameras (especially Android, or iPhone ProRAW/Live Photos) can exceed the old 8MB limit on a single full-resolution photo


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
    skip_reason = None  # last reason a file was skipped, for a more honest error message below
    for f in files:
        if f.size > MAX_UPLOAD_BYTES:
            skip_reason = 'size'
            print(f'[upload_listing_images] skipped oversized file: {f.name} ({f.size} bytes)')
            continue
        try:
            data_url = _compress_to_data_url(f)
        except Exception as exc:
            skip_reason = 'format'
            print(f'[upload_listing_images] skipped unreadable file: {f.name} ({f.size} bytes) - {exc}')
            continue
        img = ListingImage.objects.create(listing=None, image=data_url)
        created_ids.append(img.id)

    if not created_ids:
        if skip_reason == 'size':
            error = f"Rasm hajmi juda katta (maksimum {MAX_UPLOAD_BYTES // (1024*1024)}MB)."
        elif skip_reason == 'format':
            error = "Rasm formati qo'llab-quvvatlanmaydi. Boshqa rasm tanlang yoki skrinshot qiling."
        else:
            error = "Hech qanday rasm yuklanmadi."
        return Response({'ok': False, 'error': error}, status=400)
    return Response({'ok': True, 'imageIds': created_ids})


MAX_VOICE_NOTE_BYTES = 5 * 1024 * 1024  # 5MB - opus-encoded browser recordings are small


class VoiceNoteThrottle(AnonRateThrottle):
    scope = 'listing_images'  # shares the photo-upload rate limit, same abuse shape


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([VoiceNoteThrottle])
def upload_voice_note(request):
    """
    Same pre-upload-then-link pattern as upload_listing_images, for the
    (at most one) spoken voice note recorded in-browser while posting a
    listing. Stored as-is (already opus/webm-encoded by the browser's
    MediaRecorder, no server-side re-encoding) as a data: URI in Postgres.
    """
    f = request.FILES.get('audio')
    if not f:
        return Response({'ok': False, 'error': "Audio fayl topilmadi."}, status=400)
    if f.size > MAX_VOICE_NOTE_BYTES:
        return Response({'ok': False, 'error': "Audio fayl hajmi juda katta."}, status=400)

    import base64
    try:
        content_type = f.content_type or 'audio/webm'
        b64 = base64.b64encode(f.read()).decode('ascii')
        data_url = f'data:{content_type};base64,{b64}'
        note = VoiceNote.objects.create(listing=None, audio=data_url)
    except Exception as exc:
        print(f'[upload_voice_note] failed: {exc}')
        return Response({'ok': False, 'error': "Ovozli xabarni saqlashda xato yuz berdi."}, status=500)
    return Response({'ok': True, 'voiceNoteId': note.id})


@api_view(['DELETE'])
@permission_classes([IsAdminUser])
def delete_listing_image(request, image_id):
    # Admin-only: lets a bad/placeholder photo be removed from a listing
    # without deleting the whole listing. Idempotent - deleting an id
    # that's already gone is not an error.
    ListingImage.objects.filter(id=image_id).delete()
    return Response({'ok': True})


class VerificationThrottle(AnonRateThrottle):
    scope = 'verification_submit'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([VerificationThrottle])
def submit_verification(request):
    """
    User sends an ID photo + a selfie holding it. Creates a pending
    VerificationRequest for an admin to review in the panel; approving it
    is what actually flips Profile.verified. One pending request at a
    time per profile - resubmitting while one is still pending just
    replaces it rather than piling up duplicates.
    """
    username = str(request.data.get('username', '')).strip()
    if not username:
        return Response({'ok': False, 'error': "Foydalanuvchi aniqlanmadi."}, status=400)
    # username isn't a unique column (a leftover phone-format bug once let
    # the same person end up with more than one Profile row sharing a
    # username, before normalize_phone() fixed that) - .get() would raise
    # MultipleObjectsReturned for those accounts, so this has to tolerate
    # more than one match instead of assuming exactly one.
    profiles = Profile.objects.filter(username=username)
    if not profiles.exists():
        return Response({'ok': False, 'error': "Profil topilmadi."}, status=404)

    if profiles.filter(verified=True).exists():
        return Response({'ok': False, 'error': "Profilingiz allaqachon tasdiqlangan."}, status=400)
    profile = profiles.order_by('-created_at').first()

    id_photo = request.FILES.get('id_photo')
    selfie_photo = request.FILES.get('selfie_photo')
    if not id_photo or not selfie_photo:
        return Response({'ok': False, 'error': "Hujjat rasmi va selfie ikkalasi ham kerak."}, status=400)
    for f in (id_photo, selfie_photo):
        if f.size > MAX_UPLOAD_BYTES:
            return Response({'ok': False, 'error': "Rasm hajmi juda katta."}, status=400)

    try:
        id_photo_url = _compress_to_data_url(id_photo)
        selfie_photo_url = _compress_to_data_url(selfie_photo)
    except Exception:
        return Response({'ok': False, 'error': "Rasmni o'qib bo'lmadi."}, status=400)

    # Replace any earlier pending/rejected attempt rather than stacking up.
    VerificationRequest.objects.filter(profile__in=profiles, status__in=['pending', 'rejected']).delete()
    VerificationRequest.objects.create(profile=profile, id_photo=id_photo_url, selfie_photo=selfie_photo_url)
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([AllowAny])
def verification_status(request):
    username = str(request.query_params.get('username', '')).strip()
    if not username:
        return Response({'verified': False, 'pending': False})
    # See the comment in submit_verification - username can match more
    # than one Profile row, so this checks across all of them rather than
    # assuming a single match.
    profiles = Profile.objects.filter(username=username)
    if not profiles.exists():
        return Response({'verified': False, 'pending': False})
    verified = profiles.filter(verified=True).exists()
    pending = VerificationRequest.objects.filter(profile__in=profiles, status='pending').exists()
    return Response({'verified': verified, 'pending': pending})


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_verification_requests(request):
    reqs = VerificationRequest.objects.filter(status='pending').select_related('profile').order_by('created_at')
    data = [{
        'id': r.id,
        'username': r.profile.username,
        'fullName': r.profile.full_name,
        'phone': r.profile.phone,
        'idPhoto': r.id_photo,
        'selfiePhoto': r.selfie_photo,
        'createdAt': r.created_at.isoformat(),
    } for r in reqs]
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_verification_decide(request, request_id):
    decision = request.data.get('decision')
    if decision not in ('approve', 'reject'):
        return Response({'ok': False, 'error': "decision 'approve' yoki 'reject' bo'lishi kerak."}, status=400)
    try:
        vr = VerificationRequest.objects.select_related('profile').get(id=request_id, status='pending')
    except VerificationRequest.DoesNotExist:
        return Response({'ok': False, 'error': "So'rov topilmadi yoki allaqachon ko'rib chiqilgan."}, status=404)

    from django.utils import timezone
    vr.status = 'approved' if decision == 'approve' else 'rejected'
    vr.reviewed_at = timezone.now()
    vr.save(update_fields=['status', 'reviewed_at'])
    if decision == 'approve':
        vr.profile.verified = True
        vr.profile.save(update_fields=['verified'])
    return Response({'ok': True})


DISCOUNT_TIER_LABELS = {'top': 'TOP', 'vip': 'VIP'}


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_create_discount(request):
    """Admin grants one profile a % off their NEXT top/vip purchase (see
    TierDiscount + _discounted_price_cents). Notifies the profile the same
    way any other message does - there's no separate notification system,
    the bell icon already just shows unread Messages."""
    profile_id = request.data.get('profile_id')
    tier = str(request.data.get('tier', '')).strip()
    try:
        percent = int(request.data.get('percent'))
    except (TypeError, ValueError):
        percent = None
    if tier not in ('top', 'vip'):
        return Response({'ok': False, 'error': "Tur 'top' yoki 'vip' bo'lishi kerak."}, status=400)
    if percent is None or not (1 <= percent <= 100):
        return Response({'ok': False, 'error': "Foiz 1 dan 100 gacha bo'lishi kerak."}, status=400)
    try:
        profile = Profile.objects.get(id=profile_id)
    except Profile.DoesNotExist:
        return Response({'ok': False, 'error': "Profil topilmadi."}, status=404)

    discount = TierDiscount.objects.create(profile=profile, tier=tier, percent=percent)
    tier_label = DISCOUNT_TIER_LABELS[tier]
    Message.objects.create(
        sender='Jizzax UyJoy',
        receiver=profile.username,
        text=f"Admin tomonidan sizga {tier_label}'ga e'lon qo'shishingiz uchun {percent}% chegirma berildi!",
    )
    return Response({'ok': True, 'id': discount.id})


@api_view(['GET'])
@permission_classes([AllowAny])
def my_discounts(request):
    """Active (unused) discounts for one username, e.g. {'top': 30} -
    used by the tier-picker (step4) to show/apply the discounted price."""
    username = str(request.query_params.get('username', '')).strip()
    if not username:
        return Response({})
    result = {}
    for d in TierDiscount.objects.filter(profile__username=username, used=False).order_by('created_at'):
        result[d.tier] = d.percent  # later (newer) rows win if more than one for the same tier
    return Response(result)


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
        # TOP/VIP portion mirrors tier_breakdown below - value of
        # listings currently at that tier, created in this window -
        # rather than raw Stripe payment history, so it's never out of
        # step with the "N ta TOP/VIP e'lon" counters shown elsewhere on
        # this dashboard (a listing can be at a tier without ever having
        # gone through a real payment, e.g. admin-seeded demo listings).
        total = 0
        for tier_key in ('top', 'vip'):
            count = Listing.objects.filter(**{tier_key: True}, created_at__gte=since).count()
            total += count * settings.LISTING_PRICE_CENTS.get(tier_key, 0)
        total += PendingBalanceTopup.objects.filter(paid=True, created_at__gte=since).aggregate(s=Sum('amount_cents'))['s'] or 0
        return total

    # Every registered profile, not just the ones who've posted a
    # listing - a seller-only list used to silently drop anyone who
    # signed up but never posted. Listing stats are 0 for those.
    listing_stats_by_username = {
        row['seller']: row
        for row in Listing.objects.values('seller').annotate(
            listing_count=Count('id'),
            total_views=Sum('views_count'),
            total_likes=Sum('likes_count'),
            top_count=Count('id', filter=Q(top=True)),
            vip_count=Count('id', filter=Q(vip=True)),
        )
    }
    # Real, audited money actually collected (see PaymentEvent) - accurate
    # going forward, but 0 for any listing that reached TOP/VIP some
    # other way (seeded/demo data, or anything predating this tracking).
    paid_by_username = {
        row['username']: row['s']
        for row in PaymentEvent.objects.values('username').annotate(s=Sum('amount_cents'))
    }
    top_price = settings.LISTING_PRICE_CENTS.get('top', 0)
    vip_price = settings.LISTING_PRICE_CENTS.get('vip', 0)
    by_seller = []
    for username in Profile.objects.order_by('username').values_list('username', flat=True):
        stats = listing_stats_by_username.get(username)
        top_count = stats['top_count'] if stats else 0
        vip_count = stats['vip_count'] if stats else 0
        by_seller.append({
            'seller': username,
            'listing_count': stats['listing_count'] if stats else 0,
            'total_views': stats['total_views'] if stats else 0,
            'total_likes': stats['total_likes'] if stats else 0,
            'total_paid_cents': paid_by_username.get(username, 0),
            # Notional value of their CURRENTLY-active TOP/VIP listings
            # (count * that tier's price) - matches how tier_breakdown
            # below values the site-wide totals, so it's never 0 just
            # because a listing reached TOP/VIP without an audited
            # PaymentEvent (e.g. it predates this tracking).
            'top_count': top_count,
            'vip_count': vip_count,
            'top_value_cents': top_count * top_price,
            'vip_value_cents': vip_count * vip_price,
        })
    by_seller.sort(key=lambda r: r['listing_count'], reverse=True)

    # Site-wide totals (not per-seller) - for the top stat-box row.
    site_totals = Listing.objects.aggregate(views=Sum('views_count'), likes=Sum('likes_count'))

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

    # Broken down by tier (top/vip) - count of listings CURRENTLY at that
    # tier (matches the "VIP e'lonlar"/"TOP e'lonlar" counters above),
    # with the tier's price as its notional value. Not the same as actual
    # Stripe revenue (a listing can be at a tier without ever having gone
    # through a real payment, e.g. admin-seeded demo listings) - real
    # money collected is what revenueCents* below tracks separately.
    tier_breakdown = {}
    for tier_key in ('top', 'vip'):
        count = Listing.objects.filter(**{tier_key: True}).count()
        tier_breakdown[tier_key] = {
            'count': count,
            'revenueCents': count * settings.LISTING_PRICE_CENTS.get(tier_key, 0),
        }

    return Response({
        'sellers': list(by_seller),
        'totalListings': Listing.objects.count(),
        'totalViews': site_totals['views'] or 0,
        'totalLikes': site_totals['likes'] or 0,
        'soldListings': sold_qs.count(),
        'soldListingsDetail': sold_detail,
        'soldListingsTotalPriceNumber': sold_total_number,
        # Matches tierBreakdown below (current TOP+VIP listing counts),
        # not raw Stripe payment history - see the comment above
        # tier_breakdown for why those two can differ.
        'paidListingsBought': tier_breakdown['top']['count'] + tier_breakdown['vip']['count'],
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
    #
    # `verified` here is "any Profile row with this username is verified",
    # not the raw per-row column - username isn't unique (a leftover
    # phone-format bug once let one person end up with more than one
    # Profile row sharing a username), so without this, whichever
    # duplicate the frontend happens to look up first could wrongly show
    # as unverified even after a real approval.
    from django.db.models import Exists, OuterRef
    verified_elsewhere = Profile.objects.filter(username=OuterRef('username'), verified=True)
    rows = Profile.objects.order_by('username').annotate(
        any_verified=Exists(verified_elsewhere)
    ).values('username', 'full_name', 'role', 'any_verified')
    data = [
        {'username': r['username'], 'full_name': r['full_name'], 'role': r['role'], 'verified': r['any_verified']}
        for r in rows
    ]
    return Response(data)


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


def _discounted_price_cents(base_cents, username, tier):
    """An admin-granted TierDiscount (see TierDiscount model + the
    admin_create_discount view) knocks a percentage off the NEXT TOP/VIP
    purchase for that profile+tier. Returns (final_cents, discount_or_None)
    - the discount is NOT marked used here, only found; the caller marks
    it used once the purchase actually completes (see
    _finalize_pending_payment / create_listing_from_balance)."""
    if not username:
        return base_cents, None
    discount = TierDiscount.objects.filter(
        profile__username=username, tier=tier, used=False
    ).order_by('-created_at').first()
    if not discount:
        return base_cents, None
    final = max(round(base_cents * (100 - discount.percent) / 100), 0)
    return final, discount


def _record_payment_event(username, kind, tier, amount_cents):
    if username:
        PaymentEvent.objects.create(username=username, kind=kind, tier=tier or '', amount_cents=amount_cents)


@api_view(['GET'])
@permission_classes([AllowAny])
def currency_rate(request):
    """USD/UZS so'm rate, for converting between listing prices entered
    in 'у.е' (locally always treated as 1:1 with USD) and so'm. Sourced
    from the Central Bank of Uzbekistan's own public rate API - the
    number everyone here actually prices real estate against - and
    cached for an hour so every page load/currency toggle doesn't hit
    cbu.uz directly."""
    from django.core.cache import cache

    rate = cache.get('usd_uzs_rate')
    if rate:
        return Response({'ok': True, 'rate': rate, 'cached': True})

    try:
        url = 'https://cbu.uz/en/arkhiv-kursov-valyut/json/USD/'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        rate = float(data[0]['Rate'])
    except Exception as exc:
        print(f'[currency_rate] cbu.uz fetch failed: {exc}')
        # A stale cached value beats none - fall back to a fixed estimate
        # only if we've genuinely never fetched one successfully yet.
        rate = cache.get('usd_uzs_rate_stale') or 12700.0

    cache.set('usd_uzs_rate', rate, 3600)  # 1 hour
    cache.set('usd_uzs_rate_stale', rate, None)  # never expires - last-known-good fallback
    return Response({'ok': True, 'rate': rate, 'cached': False})


@api_view(['GET'])
@permission_classes([AllowAny])
def payment_config(request):
    # Lets the frontend show real prices/currency and know whether Stripe
    # keys have even been set yet, without ever seeing the secret key.
    username = str(request.query_params.get('username', '')).strip()
    discounts = {}
    if username:
        for d in TierDiscount.objects.filter(profile__username=username, used=False):
            # Only the newest active discount per tier matters for display.
            if d.tier not in discounts or d.created_at > discounts[d.tier]['created_at']:
                discounts[d.tier] = {'percent': d.percent, 'created_at': d.created_at}
        discounts = {tier: v['percent'] for tier, v in discounts.items()}
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
        # Admin-granted % off this profile's NEXT top/vip purchase, e.g.
        # {'top': 30} - empty if none or no username given.
        'discounts': discounts,
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

    # An admin-granted discount (see TierDiscount) is only found here, not
    # spent yet - _finalize_pending_payment marks it used once this
    # checkout actually completes, via the _discount_id it's stashed in below.
    amount, discount = _discounted_price_cents(amount, listing_payload.get('seller'), tier)
    if discount:
        listing_payload['_discount_id'] = discount.id

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


def _apply_tier_upgrade(listing, tier):
    """Bump an already-live listing to a higher paid tier (regular->top/
    vip, top->vip - never a downgrade, callers only ever offer strictly
    better tiers). Restarts its lifecycle clock at the new tier's stage,
    exactly like a fresh post at that tier would (see TIER_LIFECYCLE)."""
    from django.utils import timezone
    listing.vip = (tier == 'vip')
    listing.top = (tier == 'top')
    listing.posted_tier = tier
    listing.stage_started_at = timezone.now()
    listing.save(update_fields=['vip', 'top', 'posted_tier', 'stage_started_at'])
    return listing


def _finalize_pending_payment(pending):
    """Idempotent: create the Listing for a paid pending row exactly once
    (or, for a tier-upgrade pending row, apply the upgrade exactly once).

    Called from both the success-redirect confirm endpoint and the
    webhook - whichever gets there first wins, the other is a no-op.
    """
    from django.utils import timezone
    if pending.created_listing_id:
        return pending.created_listing
    # Tier-upgrade payments (see ListingViewSet.upgrade_tier_checkout)
    # smuggle the target listing's id in here instead of a full listing
    # payload - there's no new Listing to create, just flags to flip on
    # the existing one.
    upgrade_listing_id = pending.payload.get('_upgrade_listing_id')
    if upgrade_listing_id:
        listing = Listing.objects.get(pk=upgrade_listing_id)
        listing = _apply_tier_upgrade(listing, pending.tier)
        pending.paid = True
        pending.created_listing = listing
        pending.save(update_fields=['paid', 'created_listing'])
        _record_payment_event(listing.seller, 'tier_upgrade', pending.tier, pending.amount_cents)
        return listing
    serializer = ListingSerializer(data=pending.payload)
    serializer.is_valid(raise_exception=True)
    listing = serializer.save()
    _link_images_to_listing(pending.payload.get('image_ids'), listing)
    _link_voice_note_to_listing(pending.payload.get('voice_note_id'), listing)
    pending.paid = True
    pending.created_listing = listing
    pending.save(update_fields=['paid', 'created_listing'])
    discount_id = pending.payload.get('_discount_id')
    if discount_id:
        TierDiscount.objects.filter(id=discount_id, used=False).update(used=True, used_at=timezone.now())
    _record_payment_event(listing.seller, 'tier_purchase', pending.tier, pending.amount_cents)
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
    _record_payment_event(profile.username, 'balance_topup', '', pending.amount_cents)
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

    # An admin-granted discount (see TierDiscount) applies here too, same
    # as the card-checkout path - the balance check/deduction below uses
    # this (possibly lower) amount, not the sticker price.
    amount, discount = _discounted_price_cents(amount, listing_payload.get('seller'), tier)

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
    _link_voice_note_to_listing(listing_payload.get('voice_note_id'), listing)
    if discount:
        from django.utils import timezone
        TierDiscount.objects.filter(id=discount.id, used=False).update(used=True, used_at=timezone.now())
    _record_payment_event(listing.seller, 'tier_purchase', tier, amount)
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


def _telegram_gateway_api(method, **params):
    """Calls Telegram's official Gateway API (gatewayapi.telegram.org) -
    a separate, paid product from the free Bot API above. Given just a
    phone number it delivers a verification code straight to that
    number's Telegram account - Telegram does the phone-to-account
    lookup on their end, so there's no bot to start and no contact to
    share. Returns the parsed JSON body (even on a 4xx - Telegram's
    error responses are still useful JSON), or None on a real network
    failure or if no token is configured."""
    if not settings.TELEGRAM_GATEWAY_TOKEN:
        return None
    url = f'https://gatewayapi.telegram.org/{method}'
    data = json.dumps(params).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {settings.TELEGRAM_GATEWAY_TOKEN}',
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode('utf-8'))
        except Exception:
            print(f'[_telegram_gateway_api] {method} HTTP {exc.code}')
            return None
    except Exception as exc:
        print(f"[_telegram_gateway_api] {method} failed: {exc}")
        return None


class TelegramStartThrottle(AnonRateThrottle):
    scope = 'telegram_start'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([TelegramStartThrottle])
def telegram_start(request):
    if not settings.TELEGRAM_GATEWAY_TOKEN:
        return Response({'ok': False, 'error': "Tasdiqlash xizmati hali sozlanmagan."}, status=503)
    phone = normalize_phone(request.data.get('phone', ''))
    if not phone:
        return Response({'ok': False, 'error': "Telefon raqami kerak."}, status=400)

    e164 = phone if phone.startswith('+') else f'+998{phone}'
    result = _telegram_gateway_api(
        'sendVerificationMessage',
        phone_number=e164, code_length=6, ttl=300,
    )
    if not result or not result.get('ok'):
        error = (result or {}).get('error', "noma'lum xato")
        print(f'[telegram_start] sendVerificationMessage failed: {error}')
        return Response({'ok': False, 'error': "Kod yuborishda xato yuz berdi. Qaytadan urinib ko'ring."}, status=502)

    request_id = result['result']['request_id']
    verification = TelegramVerification.objects.create(phone=phone, gateway_request_id=request_id)
    return Response({'ok': True, 'token': verification.token})


@api_view(['GET'])
@permission_classes([AllowAny])
def telegram_status(request):
    # Kept for backward compatibility with the old polling-based frontend
    # flow - the Gateway API delivers the code synchronously (by the time
    # telegram_start returns, it's already sent), so codeSent is just
    # "did telegram_start succeed for this token".
    token = request.query_params.get('token', '')
    try:
        v = TelegramVerification.objects.get(token=token)
    except TelegramVerification.DoesNotExist:
        return Response({'ok': False, 'error': "Topilmadi."}, status=404)
    return Response({'ok': True, 'codeSent': bool(v.gateway_request_id), 'verified': v.verified})


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
    if not v.gateway_request_id:
        return Response({'ok': False, 'error': "Kod hali yuborilmagan."}, status=400)

    result = _telegram_gateway_api('checkVerificationStatus', request_id=v.gateway_request_id, code=code)
    if not result or not result.get('ok'):
        return Response({'ok': False, 'error': "Tekshirishda xato yuz berdi. Qaytadan urinib ko'ring."}, status=502)

    status_val = (result['result'].get('verification_status') or {}).get('status')
    if status_val != 'code_valid':
        friendly = {
            'code_invalid': "Kod noto'g'ri.",
            'code_max_attempts_exceeded': "Urinishlar soni tugadi. Qaytadan so'rang.",
            'expired': "Kod muddati tugagan. Qaytadan so'rang.",
        }.get(status_val, "Kod noto'g'ri.")
        return Response({'ok': False, 'error': friendly}, status=400)

    v.verified = True
    v.save(update_fields=['verified'])
    return Response({'ok': True, 'phone': v.phone})


@api_view(['POST'])
@permission_classes([AllowAny])
def google_auth(request):
    """
    'Sign in with Google': the frontend never sees or handles the user's
    real Google password - Google's own Identity Services widget
    authenticates them and hands the frontend a signed ID token (JWT).
    This just verifies that token really came from Google, for THIS
    app, and wasn't expired/tampered with (via Google's own tokeninfo
    endpoint - simplest verification path, no crypto library needed),
    then finds or creates the matching Profile by email.
    """
    if not settings.GOOGLE_CLIENT_ID:
        return Response({'ok': False, 'error': "Google bilan kirish hali sozlanmagan."}, status=503)
    credential = str(request.data.get('credential', ''))
    if not credential:
        return Response({'ok': False, 'error': "Google ma'lumoti topilmadi."}, status=400)

    url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + urllib.parse.quote(credential)
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError:
        return Response({'ok': False, 'error': "Google tokeni yaroqsiz yoki muddati o'tgan."}, status=400)
    except Exception as exc:
        print(f'[google_auth] tokeninfo failed: {exc}')
        return Response({'ok': False, 'error': "Google bilan bog'lanishda xato yuz berdi."}, status=502)

    # aud must be OUR client id (else this token was issued for some
    # other app and we shouldn't trust it as proof of identity here).
    if payload.get('aud') != settings.GOOGLE_CLIENT_ID:
        return Response({'ok': False, 'error': "Google tokeni yaroqsiz."}, status=400)
    if payload.get('iss') not in ('accounts.google.com', 'https://accounts.google.com'):
        return Response({'ok': False, 'error': "Google tokeni yaroqsiz."}, status=400)

    email = str(payload.get('email', '')).strip().lower()
    if not email:
        return Response({'ok': False, 'error': "Google hisobida email topilmadi."}, status=400)
    full_name = str(payload.get('name', '')).strip()

    profile = Profile.objects.filter(email__iexact=email).first()
    if profile:
        return Response({'ok': True, 'profile': ProfileSerializer(profile).data})

    # New signup - derive a username from the email's local part, made
    # unique if it's already taken by someone else.
    base_username = re.sub(r'[^a-z0-9_]', '', email.split('@')[0].lower()) or 'foydalanuvchi'
    username = base_username
    suffix = 1
    while Profile.objects.filter(username=username).exists():
        suffix += 1
        username = f'{base_username}{suffix}'

    profile = Profile.objects.create(email=email, username=username, full_name=full_name, role='Uy egasi')
    return Response({'ok': True, 'profile': ProfileSerializer(profile).data}, status=201)


@api_view(['POST'])
@permission_classes([AllowAny])
def simple_register(request):
    """'Oddiy ro'yxatdan o'tish' - a friction-free alternative to Google
    sign-in: just a name + phone number, no password, no code. Finds the
    existing profile for that phone if there is one (same person
    signing back in), otherwise creates a new one - exactly the
    find-or-create-by-identity shape google_auth uses, keyed by phone
    instead of email."""
    full_name = str(request.data.get('full_name', '')).strip()
    phone = normalize_phone(request.data.get('phone', ''))
    if not full_name:
        return Response({'ok': False, 'error': "Ism familiyangizni kiriting."}, status=400)
    if len(phone) != 9:
        return Response({'ok': False, 'error': "To'g'ri telefon raqam kiriting."}, status=400)

    profile = Profile.objects.filter(phone=phone).first()
    if profile:
        # Welcome back - refresh the name in case it changed, keep everything else.
        if full_name and profile.full_name != full_name:
            profile.full_name = full_name
            profile.save(update_fields=['full_name'])
        return Response({'ok': True, 'profile': ProfileSerializer(profile).data})

    base_username = re.sub(r'[^a-z0-9_]', '', full_name.lower().replace(' ', '_')) or 'foydalanuvchi'
    username = base_username
    suffix = 1
    while Profile.objects.filter(username=username).exists():
        suffix += 1
        username = f'{base_username}{suffix}'

    profile = Profile.objects.create(phone=phone, username=username, full_name=full_name, role='Uy egasi')
    return Response({'ok': True, 'profile': ProfileSerializer(profile).data}, status=201)


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
    contact = message.get('contact')
    from_user_id = (message.get('from') or {}).get('id')

    if chat_id and text.startswith('/start'):
        parts = text.split(maxsplit=1)
        token = parts[1].strip() if len(parts) == 2 else ''
        if token:
            try:
                v = TelegramVerification.objects.get(token=token)
            except TelegramVerification.DoesNotExist:
                v = None
            if v and not v.verified:
                if v.code:
                    # Phone was already confirmed for this token earlier -
                    # just resend the same code rather than making them
                    # share their contact again.
                    _telegram_api(
                        'sendMessage', chat_id=chat_id,
                        text=f"Jizzax UyJoy tasdiqlash kodi: {v.code}\n\nBu kodni hech kimga bermang.",
                    )
                else:
                    # Don't trust "whoever clicked the link" - the code
                    # must only ever reach the Telegram account that
                    # actually owns the phone number typed on the site.
                    # request_contact makes Telegram itself hand us the
                    # account's real verified phone number (not a
                    # user-typable field) so it can be checked below.
                    v.chat_id = str(chat_id)
                    v.save(update_fields=['chat_id'])
                    _telegram_api(
                        'sendMessage', chat_id=chat_id,
                        text="Davom etish uchun telefon raqamingizni ulashing - kod faqat shu raqamga tegishli Telegram hisobiga yuboriladi.",
                        reply_markup={
                            'keyboard': [[{'text': '📱 Telefon raqamimni ulashish', 'request_contact': True}]],
                            'resize_keyboard': True, 'one_time_keyboard': True,
                        },
                    )
    elif chat_id and contact:
        v = TelegramVerification.objects.filter(chat_id=str(chat_id), verified=False, code='').order_by('-created_at').first()
        if v:
            shared_phone = normalize_phone(contact.get('phone_number', ''))
            shared_user_id = contact.get('user_id')
            # user_id check: must be THEIR OWN contact card, not one
            # forwarded/shared on behalf of someone else.
            if shared_user_id == from_user_id and shared_phone == v.phone:
                code = f"{random.randint(0, 999999):06d}"
                v.code = code
                v.save(update_fields=['code'])
                _telegram_api(
                    'sendMessage', chat_id=chat_id,
                    text=f"Jizzax UyJoy tasdiqlash kodi: {code}\n\nBu kodni hech kimga bermang.",
                    reply_markup={'remove_keyboard': True},
                )
            else:
                _telegram_api(
                    'sendMessage', chat_id=chat_id,
                    text="Bu Telegram hisobining telefon raqami saytda kiritilgan raqam bilan mos kelmadi. Saytga to'g'ri raqamni kiriting yoki shu raqamga ro'yxatdan o'tgan Telegram hisobidan urining.",
                    reply_markup={'remove_keyboard': True},
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
