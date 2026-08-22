import re

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
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class ListingImage(models.Model):
    listing = models.ForeignKey(Listing, related_name='images', on_delete=models.CASCADE)
    image = models.ImageField(upload_to='listings/')

    def __str__(self):
        return f"{self.listing.title} - image"
class Profile(models.Model):
    phone = models.CharField(max_length=30, unique=True)
    username = models.CharField(max_length=100, blank=True)
    full_name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=100, default="Uy egasi")
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