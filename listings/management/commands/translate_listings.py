"""Translate every listing whose translation is missing or out of date.

    python manage.py translate_listings

Normally the site does this on its own (right after a listing is saved, and
a few at a time later if the free daily quota ran out); this is for a
one-off backfill.
"""
from django.core.management.base import BaseCommand

from listings import translate
from listings.models import Listing


class Command(BaseCommand):
    help = 'Machine-translate listing titles/descriptions that are missing or stale'

    def handle(self, *args, **options):
        for listing in Listing.objects.order_by('id'):
            if not translate.needs_translation(listing):
                continue
            try:
                translate.translate_listing(listing.id)
            except translate.QuotaExceeded:
                self.stdout.write(self.style.WARNING('Daily translation quota used up - run again tomorrow.'))
                return
            listing.refresh_from_db()
            self.stdout.write(f"{listing.id}: {listing.translations.get('_lang')} -> "
                              f"{', '.join(k for k in listing.translations if not k.startswith('_'))}")
