from rest_framework import serializers
from .models import Listing, ListingImage, Profile


class ListingImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingImage
        fields = ['id', 'image']


class ListingSerializer(serializers.ModelSerializer):
    images = ListingImageSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            'id', 'title', 'desc', 'price', 'district', 'lat', 'lng',
            'rooms', 'area', 'floor', 'type', 'type_key', 'repair',
            'condition', 'phone', 'seller', 'owner_role', 'owner',
            'mortgage', 'deal', 'vip', 'top', 'created_at', 'images',
        ]

from .models import Profile


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['id', 'phone', 'username', 'full_name', 'role', 'created_at']