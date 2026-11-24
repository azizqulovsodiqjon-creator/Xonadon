from django.contrib import admin, messages
from django.utils.html import format_html

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


class HasReceiptFilter(admin.SimpleListFilter):
    title = 'chek'
    parameter_name = 'chek'

    def lookups(self, request, model_admin):
        return [('bor', 'Chek yuborilgan'), ('yoq', 'Chek yo\'q')]

    def queryset(self, request, queryset):
        if self.value() == 'bor':
            return queryset.exclude(receipt='')
        if self.value() == 'yoq':
            return queryset.filter(receipt='')
        return queryset


@admin.register(UzPayment)
class UzPaymentAdmin(admin.ModelAdmin):
    list_display = ('id', 'provider', 'kind', 'amount_uzs', 'has_receipt', 'payer_note', 'paid', 'created_at')
    list_filter = ('provider', 'paid', HasReceiptFilter)
    search_fields = ('session_id', 'payer_note')
    ordering = ('-created_at',)
    readonly_fields = ('provider', 'kind', 'session_id', 'amount_uzs', 'paid', 'paid_at', 'receipt_preview',
                       'receipt_uploaded_at', 'payer_note', 'pending_listing', 'pending_topup', 'created_at')
    exclude = ('receipt',)
    actions = ['confirm_transfers']

    @admin.display(boolean=True, description='Chek')
    def has_receipt(self, obj):
        return bool(obj.receipt)

    @admin.display(description="To'lov cheki")
    def receipt_preview(self, obj):
        if not obj.receipt:
            return "Chek hali yuborilmagan"
        # Browsers won't open a data: URL in a new tab, so the image is shown
        # inline, large enough to read.
        return format_html('<img src="{}" style="max-width:520px;width:100%;border:1px solid #ccc;'
                           'border-radius:8px">', obj.receipt)

    @admin.action(description="Pul tushdi - tasdiqlash (faqat kartaga o'tkazma)")
    def confirm_transfers(self, request, queryset):
        from . import uzpay
        done = skipped = 0
        for payment in queryset.filter(provider='transfer', paid=False):
            # The payer must have sent the receipt first - the listing is
            # only posted once a receipt was checked and confirmed here.
            if not payment.receipt:
                skipped += 1
                continue
            uzpay._finish(payment, request)
            done += 1
        msg = f"Tasdiqlandi: {done} ta to'lov."
        if skipped:
            msg += f" Chek yuborilmagani uchun o'tkazib yuborildi: {skipped} ta."
        self.message_user(request, msg, level=messages.WARNING if skipped else messages.SUCCESS)
