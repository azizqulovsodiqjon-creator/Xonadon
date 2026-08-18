from django.shortcuts import render
from rest_framework import viewsets
from .models import Listing, Profile
from .serializers import ListingSerializer, ProfileSerializer


def index(request):
    return render(request, 'index.html')


class ListingViewSet(viewsets.ModelViewSet):
    queryset = Listing.objects.all().order_by('-created_at')
    serializer_class = ListingSerializer


class ProfileViewSet(viewsets.ModelViewSet):
    queryset = Profile.objects.all().order_by('-created_at')
    serializer_class = ProfileSerializer

    def get_queryset(self):
        qs = Profile.objects.all().order_by('-created_at')
        phone = self.request.query_params.get('phone')
        if phone:
            qs = qs.filter(phone=phone)
        return qs