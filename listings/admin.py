from django.contrib import admin

from .models import PendingListingPayment, Message, TelegramVerification, SoldListingRecord


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


@admin.register(TelegramVerification)
class TelegramVerificationAdmin(admin.ModelAdmin):
    list_display = ('phone', 'chat_id', 'verified', 'created_at')
    list_filter = ('verified',)
    readonly_fields = ('token', 'phone', 'chat_id', 'code', 'verified', 'created_at')


@admin.register(SoldListingRecord)
class SoldListingRecordAdmin(admin.ModelAdmin):
    list_display = ('title', 'price', 'seller', 'district', 'tier', 'created_at')
    list_filter = ('tier',)
    search_fields = ('title', 'seller', 'district')
