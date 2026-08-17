from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from .views import ListingViewSet

router = DefaultRouter()
router.register(r'listings', ListingViewSet)

urlpatterns = [
    path('', views.index, name='index'),
    path('api/', include(router.urls)),
]