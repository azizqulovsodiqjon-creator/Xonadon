from rest_framework import serializers
from .models import Listing, ListingImage, VoiceNote, Profile, Message


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

    class Meta:
        model = Listing
        fields = [
            'id', 'title', 'desc', 'price', 'currency', 'district', 'lat', 'lng',
            'rooms', 'area', 'floor', 'type', 'type_key', 'repair',
            'condition', 'phone', 'seller', 'owner_role', 'owner',
            'mortgage', 'deal', 'vip', 'top', 'sold', 'views_count',
            'likes_count', 'created_at', 'images', 'voice_note', 'is_wanted',
        ]
        # sold/views_count/likes_count only ever change through their own
        # dedicated endpoints (view/like counters, admin sold-toggle) -
        # never writable via a plain listing PATCH.
        read_only_fields = ['sold', 'views_count', 'likes_count']

from .models import Profile


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['id', 'phone', 'email', 'username', 'full_name', 'role', 'balance_cents', 'verified', 'created_at']
        # balance_cents/verified are only ever changed server-side (Stripe
        # top-up confirmation, or an admin approving a VerificationRequest)
        # - never writable directly through a profile PATCH.
        read_only_fields = ['balance_cents', 'verified']


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ['id', 'listing', 'sender', 'receiver', 'text', 'created_at', 'read']
        read_only_fields = ['id', 'created_at', 'read']