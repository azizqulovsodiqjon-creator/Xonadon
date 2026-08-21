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
    path('api/profiles/directory/', views.profiles_directory, name='profiles-directory'),
    path('api/payments/config/', views.payment_config, name='payment-config'),
    path('api/payments/create-checkout-session/', views.create_checkout_session, name='create-checkout-session'),
    path('api/payments/confirm/', views.confirm_payment, name='confirm-payment'),
    path('api/payments/webhook/', views.stripe_webhook, name='stripe-webhook'),
    path('api/messages/send/', views.send_message, name='send-message'),
    path('api/messages/thread/', views.message_thread, name='message-thread'),
    path('api/messages/conversations/', views.message_conversations, name='message-conversations'),
    path('api/', include(router.urls)),
]
