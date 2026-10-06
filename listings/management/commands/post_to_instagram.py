from django.core.management.base import BaseCommand

from listings import social


class Command(BaseCommand):
    help = "Post recent listings that are missing on Instagram (e.g. after Meta unblocked the app)."

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=14, help='only listings newer than this many days')
        parser.add_argument('--dry-run', action='store_true', help='just list what would be posted')

    def handle(self, *args, **opts):
        ids = social.missing_instagram_ids(max_age_days=opts['days'])
        self.stdout.write(f'{len(ids)} listing(s) missing on Instagram: {ids}')
        if opts['dry_run'] or not ids:
            return
        try:
            posted = social.post_missing_to_instagram(ids, social.base_url_for(None))
        except Exception as exc:
            self.stderr.write(f'stopped: {exc}')
            return
        self.stdout.write(f'posted {posted}')
