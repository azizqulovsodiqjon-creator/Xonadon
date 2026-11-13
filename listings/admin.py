from django.contrib import admin

from .models import UzPayment, PendingListingPayment, Message, TelegramVerification, SoldListingRecord, VerificationRequest


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


@admin.register(VerificationRequest)
class VerificationRequestAdmin(admin.ModelAdmin):
    list_display = ('profile', 'status', 'created_at', 'reviewed_at')
    list_filter = ('status',)
    readonly_fields = ('profile', 'id_photo', 'selfie_photo', 'created_at')


@admin.register(UzPayment)
class UzPaymentAdmin(admin.ModelAdmin):
    list_display = ('id', 'provider', 'kind', 'amount_uzs', 'payer_note', 'paid', 'created_at')
    list_filter = ('provider', 'paid')
    search_fields = ('session_id', 'payer_note')
    ordering = ('-created_at',)
    readonly_fields = ('provider', 'kind', 'session_id', 'amount_uzs', 'paid', 'paid_at', 'payer_note',
                       'pending_listing', 'pending_topup', 'created_at')
    actions = ['confirm_transfers']

    @admin.action(description="Pul tushdi - tasdiqlash (faqat kartaga o'tkazma)")
    def confirm_transfers(self, request, queryset):
        from . import uzpay
        done = 0
        for payment in queryset.filter(provider='transfer', paid=False):
            uzpay._finish(payment, request)
            done += 1
        self.message_user(request, f"Tasdiqlandi: {done} ta to'lov.")
