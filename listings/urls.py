from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from .views import ListingViewSet, ProfileViewSet

router = DefaultRouter()
router.register(r'listings', ListingViewSet)
router.register(r'profiles', ProfileViewSet)
urlpatterns = [
    path('', views.index, name='index'),
    path('api/', include(router.urls)),
]