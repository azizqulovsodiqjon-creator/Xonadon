import re
import secrets

from django.db import models
from django.utils import timezone


def normalize_phone(raw):
    """
    Collapse any way a phone number might be typed/formatted
    ('+998 90 123 45 67', '998901234567', '901234567', ...) down to one
    canonical 9-digit local form, so the same person always maps to the
    same Profile/username instead of silently forking into a new
    "account" every time they type their number slightly differently.
    """
    digits = re.sub(r'\D', '', str(raw or ''))
    if digits.startswith('998') and len(digits) > 9:
        digits = digits[-9:]
    return digits


# Per-originating-tier lifecycle: an ordered list of (stage, days) the
# listing steps through before it's deleted. TOP started listings never
# pass through VIP, and the final "regular" stage's length depends on
# which tier it started as (paid tiers get a shorter regular tail).
TIER_LIFECYCLE = {
    'vip': [('vip', 10), ('top', 5), ('regular', 2)],
    'top': [('top', 7), ('regular', 5)],
    'regular': [('regular', 7)],
}


class Listing(models.Model):
    DEAL_CHOICES = [
        ('sotuv', 'Sotuv'),
        ('ijara', 'Ijara'),
        ('kunlik', 'Kunlik'),
    ]
    POSTED_TIER_CHOICES = [('regular', 'Oddiy'), ('top', 'Top'), ('vip', 'Vip')]
    CURRENCY_CHOICES = [('ye', "у.е"), ('usd', 'USD'), ('uzs', "UZS (so'm)")]

    title = models.CharField(max_length=255)
    desc = models.TextField(blank=True)
    price = models.CharField(max_length=50)
    currency = models.CharField(max_length=10, choices=CURRENCY_CHOICES, default='ye')
    district = models.CharField(max_length=100)
    lat = models.FloatField()
    lng = models.FloatField()
    rooms = models.IntegerField(null=True, blank=True)
    area = models.IntegerField(default=0)
    floor = models.CharField(max_length=50, blank=True)
    type = models.CharField(max_length=100)
    type_key = models.CharField(max_length=50)
    repair = models.CharField(max_length=100, blank=True)
    condition = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    seller = models.CharField(max_length=100)
    owner_role = models.CharField(max_length=100, default="Uy egasi")
    owner = models.BooleanField(default=True)
    mortgage = models.BooleanField(default=False)
    deal = models.CharField(max_length=20, choices=DEAL_CHOICES, default='sotuv')
    vip = models.BooleanField(default=False)
    top = models.BooleanField(default=False)
    sold = models.BooleanField(default=False)
    views_count = models.PositiveIntegerField(default=0)
    likes_count = models.PositiveIntegerField(default=0)
    # Which tier this listing was ORIGINALLY posted/paid as - decides which
    # lifecycle (TIER_LIFECYCLE above) it steps down through as it ages.
    posted_tier = models.CharField(max_length=20, choices=POSTED_TIER_CHOICES, default='regular')
    # When the CURRENT stage (vip/top/regular) began - reset every time
    # the listing steps down a stage. Used to compute when it's next due
    # to downgrade or (at the final stage) be deleted.
    stage_started_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.pk is None:
            # First save: lock in which lifecycle this listing follows,
            # from whatever vip/top flags it was created with.
            self.posted_tier = 'vip' if self.vip else ('top' if self.top else 'regular')
            if not self.stage_started_at:
                self.stage_started_at = timezone.now()
        super().save(*args, **kwargs)

    def current_stage(self):
        if self.vip:
            return 'vip'
        if self.top:
            return 'top'
        return 'regular'

    def __str__(self):
        return self.title


class ListingImage(models.Model):
    # Nullable so a photo can be uploaded (and compressed) BEFORE the
    # listing it belongs to exists - needed for paid tiers, where the
    # real Listing isn't created until Stripe confirms payment, well
    # after the file picker in the browser (and the in-memory File
    # objects) are gone. The uploader gets an id back immediately and
    # the id travels along in the listing payload; whichever code path
    # actually creates the Listing links these rows to it afterward.
    listing = models.ForeignKey(Listing, related_name='images', on_delete=models.CASCADE, null=True, blank=True)
    # Stored as a data: URI (base64) directly in Postgres rather than on
    # local disk - Render's free-tier filesystem is wiped on every
    # deploy/restart, which silently discarded every photo before.
    image = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.listing_id or 'unlinked'} - image"


class VoiceNote(models.Model):
    """An optional spoken description recorded in-browser while posting a
    listing. Same pre-upload-then-link pattern as ListingImage (nullable
    listing FK, base64 data: URI in Postgres) for the same reason - paid
    tiers don't create the real Listing until Stripe confirms, well after
    the in-browser recording exists."""
    listing = models.OneToOneField(Listing, related_name='voice_note', on_delete=models.CASCADE, null=True, blank=True)
    audio = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.listing_id or 'unlinked'} - voice note"


class Profile(models.Model):
    phone = models.CharField(max_length=30, unique=True)
    username = models.CharField(max_length=100, blank=True)
    full_name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=100, default="Uy egasi")
    balance_cents = models.IntegerField(default=0)  # USD cents, topped up via Stripe
    # True once an admin approves a VerificationRequest for this profile -
    # drives the checkmark shown next to their name across the site.
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        # Always store the canonical form so two different-looking phone
        # numbers can never create two separate identities for the same
        # person.
        self.phone = normalize_phone(self.phone)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.username or self.phone


class Message(models.Model):
    """
    A single chat message between two users, identified by username (the
    same lightweight, client-asserted identity the rest of the site uses -
    there's no real per-request auth here, matching the existing app).
    """
    listing = models.ForeignKey(Listing, null=True, blank=True, on_delete=models.SET_NULL, related_name='messages')
    sender = models.CharField(max_length=100)
    receiver = models.CharField(max_length=100)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.sender} -> {self.receiver}: {self.text[:30]}"


class PendingListingPayment(models.Model):
    """
    A listing "waiting on payment": created right before we redirect the
    user to Stripe Checkout, and turned into a real Listing only once
    Stripe confirms the payment (via the success-redirect confirm call
    and/or the webhook - whichever arrives first; both are idempotent).

    The listing's own price/amount is decided server-side from `tier`,
    never trusted from the client, so nobody can tamper with what they
    actually pay.
    """
    TIER_CHOICES = [('regular', 'Oddiy'), ('top', 'Top'), ('vip', 'Vip')]

    stripe_session_id = models.CharField(max_length=255, unique=True)
    tier = models.CharField(max_length=20, choices=TIER_CHOICES)
    amount_cents = models.IntegerField()
    currency = models.CharField(max_length=10, default='usd')
    payload = models.JSONField()
    paid = models.BooleanField(default=False)
    created_listing = models.ForeignKey(
        Listing, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.tier} payment ({'paid' if self.paid else 'pending'}) - {self.stripe_session_id}"


class PendingBalanceTopup(models.Model):
    """A balance top-up waiting on Stripe confirmation, same idea as
    PendingListingPayment but credits a Profile's balance_cents instead
    of creating a Listing."""

    stripe_session_id = models.CharField(max_length=255, unique=True)
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name='topups')
    amount_cents = models.IntegerField()
    currency = models.CharField(max_length=10, default='usd')
    paid = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"topup {self.amount_cents}c for {self.profile} ({'paid' if self.paid else 'pending'})"


def _new_telegram_token():
    return secrets.token_urlsafe(16)


class TelegramVerification(models.Model):
    """
    Bridges the site's phone signup flow to Telegram's official Gateway
    API (gatewayapi.telegram.org) in place of SMS: given just a phone
    number, Telegram itself looks up the matching Telegram account and
    delivers the code directly - no bot to start, no contact to share.
    `token` is our own reference the frontend holds onto; it maps to
    Telegram's `gateway_request_id`, which is what's actually used to
    check the code via checkVerificationStatus.

    chat_id/code are unused by this flow (kept only so older rows from
    the previous bot-based implementation still deserialize fine).
    """
    token = models.CharField(max_length=40, unique=True, default=_new_telegram_token)
    phone = models.CharField(max_length=30)
    chat_id = models.CharField(max_length=40, blank=True)
    code = models.CharField(max_length=6, blank=True)
    gateway_request_id = models.CharField(max_length=128, blank=True)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"telegram verify {self.phone} ({'verified' if self.verified else 'pending'})"


class SoldListingRecord(models.Model):
    """
    A lightweight snapshot taken right before a sold Listing is deleted.
    Listings now disappear from the site the instant they're marked sold
    (no grace period), so nothing about the sale survives in the Listing
    table itself - this keeps just enough (title/price/seller/district/
    tier) for admin stats to still show sold-listing history/totals.
    """
    title = models.CharField(max_length=255)
    price = models.CharField(max_length=50)
    seller = models.CharField(max_length=100)
    district = models.CharField(max_length=100)
    tier = models.CharField(max_length=20, default='regular')
    original_listing_id = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"sold: {self.title} ({self.price})"


class VerificationRequest(models.Model):
    """
    One 'tasdiqlash' (verified badge) attempt: the user submits a photo
    of their ID and a selfie holding it, an admin reviews the two images
    in the admin panel and approves or rejects. Approving flips
    Profile.verified, which is what actually drives the checkmark shown
    next to their name everywhere. Images stored as data: URIs, same
    reasoning as ListingImage - Render's disk is wiped every deploy.
    """
    STATUS_CHOICES = [('pending', 'Kutilmoqda'), ('approved', 'Tasdiqlangan'), ('rejected', 'Rad etilgan')]

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name='verification_requests')
    id_photo = models.TextField()
    selfie_photo = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"verification for {self.profile} ({self.status})"


class Like(models.Model):
    """One (listing, username) like - unique together so the same person
    can't like the same listing twice, and so we can list 'my liked
    listings' reliably from the server (not just a local toggle that
    resets on reload/relogin)."""
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name='likes')
    username = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('listing', 'username')

    def __str__(self):
        return f"{self.username} likes {self.listing_id}"