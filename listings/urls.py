from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from .views import ListingViewSet, ProfileViewSet

router = DefaultRouter()
router.register(r'listings', ListingViewSet)
router.register(r'profiles', ProfileViewSet)
urlpatterns = [
    path('', views.index, name='index'),
    path('api/admin/login/', views.admin_login, name='admin-login'),
    path('api/admin/logout/', views.admin_logout, name='admin-logout'),
    path('api/admin/status/', views.admin_status, name='admin-status'),
    path('api/', include(router.urls)),
]
