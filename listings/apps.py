import os
import sys

from django.apps import AppConfig

# Management commands that either run against a not-yet-migrated database
# or simply have no business touching the User table.
_SKIP_FOR_COMMANDS = {'makemigrations', 'migrate', 'collectstatic', 'test', 'shell'}


class ListingsConfig(AppConfig):
    name = 'listings'

    def ready(self):
        # Self-healing safety net: make sure the admin panel's login
        # account exists every time the app actually starts serving
        # traffic (gunicorn/runserver) - not just when a deploy's build
        # step happens to run `manage.py ensure_admin`. This way the
        # admin account exists regardless of how the host is configured
        # to build/start the app.
        if len(sys.argv) > 1 and sys.argv[1] in _SKIP_FOR_COMMANDS:
            return
        try:
            self._ensure_admin()
        except Exception:
            # Never let this break app startup (e.g. DB not reachable yet,
            # tables not migrated yet on first boot).
            pass
        try:
            self._ensure_telegram_webhook()
        except Exception:
            pass

    def _ensure_telegram_webhook(self):
        # Same self-healing idea as _ensure_admin: point Telegram's
        # webhook at this deployment every time the app boots, so a
        # freshly-set TELEGRAM_BOT_TOKEN (or a new Render URL) takes
        # effect without any manual setWebhook call.
        import json
        import urllib.request
        from django.conf import settings

        token = settings.TELEGRAM_BOT_TOKEN
        base_url = settings.SITE_BASE_URL
        if not token or not base_url:
            print('[telegram webhook] skipped: TELEGRAM_BOT_TOKEN or SITE_BASE_URL not set')
            return
        webhook_url = base_url.rstrip('/') + '/api/telegram/webhook/'
        api_url = f'https://api.telegram.org/bot{token}/setWebhook'
        data = json.dumps({'url': webhook_url}).encode('utf-8')
        req = urllib.request.Request(api_url, data=data, headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode('utf-8')
                print(f'[telegram webhook] setWebhook({webhook_url}) -> {body}')
        except Exception as exc:
            print(f'[telegram webhook] setWebhook({webhook_url}) FAILED: {exc}')

    def _ensure_admin(self):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        username = os.environ.get('ADMIN_USERNAME', '988912')
        password = os.environ.get('ADMIN_PASSWORD', '988912')

        user, created = User.objects.get_or_create(
            username=username,
            defaults={'is_staff': True, 'is_superuser': True, 'is_active': True},
        )
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.set_password(password)
        user.save()
