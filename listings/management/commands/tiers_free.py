from django.core.management.base import BaseCommand

from listings.models import SiteSetting


class Command(BaseCommand):
    help = "TOP/VIP free for now: `tiers_free on` / `tiers_free off` (paid again) / `tiers_free` (show)."

    def add_arguments(self, parser):
        parser.add_argument('state', nargs='?', choices=['on', 'off'])

    def handle(self, *args, **opts):
        if opts['state']:
            SiteSetting.put('tiers_free', '1' if opts['state'] == 'on' else '0')
        free = SiteSetting.get('tiers_free', '0') == '1'
        self.stdout.write('TOP/VIP: ' + ('TEKIN (free)' if free else 'PULLIK (paid)'))
