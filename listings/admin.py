from django.contrib import admin

from .models import PendingListingPayment, Message


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('sender', 'receiver', 'text', 'read', 'created_at')
    list_filter = ('read',)
    search_fields = ('sender', 'receiver', 'text')


@admin.register(PendingListingPayment)
class PendingListingPaymentAdmin(admin.ModelAdmin):
    list_display = ('stripe_session_id', 'tier', 'amount_cents', 'currency', 'paid', 'created_listing', 'created_at')
    list_filter = ('paid', 'tier')
    readonly_fields = ('stripe_session_id', 'tier', 'amount_cents', 'currency', 'payload', 'created_listing', 'created_at')
