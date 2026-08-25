from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from .views import ListingViewSet, ProfileViewSet

router = DefaultRouter()
router.register(r'listings', ListingViewSet)
router.register(r'profiles', ProfileViewSet)
urlpatterns = [
    path('', views.index, name='index'),
    # Hidden admin entry point - not linked anywhere on the site. Same
    # SPA page as '/', but static/script.js detects this path on load
    # and auto-opens the admin login modal.
    path('panel/', views.index, name='admin-panel'),
    path('api/admin/login/', views.admin_login, name='admin-login'),
    path('api/admin/logout/', views.admin_logout, name='admin-logout'),
    path('api/admin/status/', views.admin_status, name='admin-status'),
    path('api/admin/stats/', views.admin_stats, name='admin-stats'),
    path('api/profiles/directory/', views.profiles_directory, name='profiles-directory'),
    path('api/likes/mine/', views.my_likes, name='my-likes'),
    path('api/listings/my-sold-count/', views.my_sold_count, name='my-sold-count'),
    path('api/listing-images/', views.upload_listing_images, name='upload-listing-images'),
    path('api/listing-images/<int:image_id>/', views.delete_listing_image, name='delete-listing-image'),
    path('api/voice-notes/', views.upload_voice_note, name='upload-voice-note'),
    path('api/verification/submit/', views.submit_verification, name='submit-verification'),
    path('api/verification/status/', views.verification_status, name='verification-status'),
    path('api/admin/verification-requests/', views.admin_verification_requests, name='admin-verification-requests'),
    path('api/admin/verification-requests/<int:request_id>/decide/', views.admin_verification_decide, name='admin-verification-decide'),
    path('api/payments/config/', views.payment_config, name='payment-config'),
    path('api/payments/create-checkout-session/', views.create_checkout_session, name='create-checkout-session'),
    path('api/payments/confirm/', views.confirm_payment, name='confirm-payment'),
    path('api/payments/webhook/', views.stripe_webhook, name='stripe-webhook'),
    path('api/payments/create-balance-topup-session/', views.create_balance_topup_session, name='create-balance-topup-session'),
    path('api/payments/confirm-balance/', views.confirm_balance_topup, name='confirm-balance-topup'),
    path('api/payments/create-listing-from-balance/', views.create_listing_from_balance, name='create-listing-from-balance'),
    path('api/messages/send/', views.send_message, name='send-message'),
    path('api/messages/thread/', views.message_thread, name='message-thread'),
    path('api/messages/conversations/', views.message_conversations, name='message-conversations'),
    path('api/telegram/start/', views.telegram_start, name='telegram-start'),
    path('api/telegram/status/', views.telegram_status, name='telegram-status'),
    path('api/telegram/verify/', views.telegram_verify, name='telegram-verify'),
    path('api/telegram/webhook/', views.telegram_webhook, name='telegram-webhook'),
    path('api/telegram/diagnostics/', views.telegram_diagnostics, name='telegram-diagnostics'),
    path('api/', include(router.urls)),
]
