from django.contrib import admin

from .models import PendingListingPayment


@admin.register(PendingListingPayment)
class PendingListingPaymentAdmin(admin.ModelAdmin):
    list_display = ('stripe_session_id', 'tier', 'amount_cents', 'currency', 'paid', 'created_listing', 'created_at')
    list_filter = ('paid', 'tier')
    readonly_fields = ('stripe_session_id', 'tier', 'amount_cents', 'currency', 'payload', 'created_listing', 'created_at')
