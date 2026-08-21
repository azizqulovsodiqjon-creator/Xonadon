from django.shortcuts import render
from django.contrib.auth import authenticate, login, logout
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from .models import Listing, Profile
from .serializers import ListingSerializer, ProfileSerializer


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
        # Anyone can browse or post a listing (that's the public site flow),
        # but only an authenticated admin (is_staff) can delete one.
        if self.action == 'destroy':
            return [IsAdminUser()]
        return [AllowAny()]


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


@api_view(['GET'])
@permission_classes([AllowAny])
def profiles_directory(request):
    # A public, privacy-safe listing of every registered user - just
    # enough (username/name/role) to power the "Profil qidirish" search,
    # without exposing phone numbers the way the full Profile list does.
    data = Profile.objects.order_by('username').values('username', 'full_name', 'role')
    return Response(list(data))
