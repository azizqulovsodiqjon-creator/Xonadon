import re

from rest_framework import serializers
from .models import Listing, ListingImage, VoiceNote, Profile, Message

# Usernames are shown all over the page as HTML and are what listings,
# messages and likes are tied to - keep them to letters, digits, '_' and '.'.
USERNAME_RE = re.compile(r'^[\w.]{2,50}$')


def _strip_angle_brackets(value):
    # Text from these fields is put into the page as HTML, so '<'/'>' would
    # let a listing title or a name carry a <script>/<img onerror> payload.
    return value.replace('<', '').replace('>', '') if isinstance(value, str) else value


class ListingImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingImage
        fields = ['id', 'image']


class VoiceNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = VoiceNote
        fields = ['id', 'audio']


class ListingSerializer(serializers.ModelSerializer):
    images = ListingImageSerializer(many=True, read_only=True)
    voice_note = VoiceNoteSerializer(read_only=True)

    TEXT_FIELDS = ('title', 'desc', 'price', 'district', 'floor', 'type', 'type_key',
                   'repair', 'condition', 'phone', 'owner_role')

    class Meta:
        model = Listing
        fields = [
            'id', 'title', 'desc', 'price', 'currency', 'district', 'lat', 'lng',
            'rooms', 'area', 'floor', 'type', 'type_key', 'repair',
            'condition', 'phone', 'seller', 'owner_role', 'owner',
            'mortgage', 'deal', 'vip', 'top', 'sold', 'views_count',
            'likes_count', 'ownership_verified', 'created_at', 'images', 'voice_note', 'is_wanted', 'translations',
        ]
        # sold/views_count/likes_count only ever change through their own
        # dedicated endpoints (view/like counters, admin sold-toggle) -
        # never writable via a plain listing PATCH. seller always comes from
        # the logged-in session (the views pass it to serializer.save()), so
        # nobody can post as, or hand a listing over to, someone else.
        read_only_fields = ['sold', 'views_count', 'likes_count', 'translations', 'ownership_verified', 'seller']

    def validate(self, attrs):
        for field in self.TEXT_FIELDS:
            if field in attrs:
                attrs[field] = _strip_angle_brackets(attrs[field])
        return attrs


class ProfileSerializer(serializers.ModelSerializer):
    def validate_username(self, value):
        from django.conf import settings
        value = str(value).strip()
        if value.lower() == settings.SUPPORT_USERNAME.lower():
            raise serializers.ValidationError("Bu nom band.")
        if self.instance is not None and value == self.instance.username:
            return value
        if not USERNAME_RE.match(value):
            raise serializers.ValidationError(
                "Profil nomi 2-50 ta harf, raqam, '_' yoki '.' dan iborat bo'lsin.")
        # username is what listings, messages and likes are tied to - taking
        # someone else's would hand you their listings and inbox.
        taken = Profile.objects.filter(username=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("Bu profil nomi band.")
        return value

    def validate_full_name(self, value):
        return _strip_angle_brackets(value)

    def validate_role(self, value):
        return _strip_angle_brackets(value)

    class Meta:
        model = Profile
        fields = ['id', 'public_id', 'phone', 'email', 'username', 'full_name', 'role', 'balance_cents', 'verified', 'created_at']
        # balance_cents/verified are only ever changed server-side (Stripe
        # top-up confirmation, or an admin approving a VerificationRequest)
        # - never writable directly through a profile PATCH. public_id is
        # assigned once at creation (see Profile.save()) and never changes.
        # email only comes from a verified Google sign-in - letting users
        # type any email here would let them grab someone else's Google login.
        read_only_fields = ['balance_cents', 'verified', 'public_id', 'email']


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ['id', 'listing', 'sender', 'receiver', 'text', 'created_at', 'read']
        read_only_fields = ['id', 'created_at', 'read']
