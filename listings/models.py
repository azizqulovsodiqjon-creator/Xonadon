import re
import secrets

from django.db import models


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


class Listing(models.Model):
    DEAL_CHOICES = [
        ('sotuv', 'Sotuv'),
        ('ijara', 'Ijara'),
        ('kunlik', 'Kunlik'),
    ]

    title = models.CharField(max_length=255)
    desc = models.TextField(blank=True)
    price = models.CharField(max_length=50)
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
    created_at = models.DateTimeField(auto_now_add=True)

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
class Profile(models.Model):
    phone = models.CharField(max_length=30, unique=True)
    username = models.CharField(max_length=100, blank=True)
    full_name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=100, default="Uy egasi")
    balance_cents = models.IntegerField(default=0)  # USD cents, topped up via Stripe
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
    Bridges the site's phone signup flow to a Telegram bot in place of
    SMS: the site creates one of these with a random `token` and opens
    t.me/<bot>?start=<token>; the user taps Start in Telegram; our
    webhook receives that /start command, records their `chat_id`, and
    sends them a 6-digit `code` via the bot. The site polls to know
    when the code has gone out, then checks what the user types back
    against `code`.
    """
    token = models.CharField(max_length=40, unique=True, default=_new_telegram_token)
    phone = models.CharField(max_length=30)
    chat_id = models.CharField(max_length=40, blank=True)
    code = models.CharField(max_length=6, blank=True)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"telegram verify {self.phone} ({'verified' if self.verified else 'pending'})"