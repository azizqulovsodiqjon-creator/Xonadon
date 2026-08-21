import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    """
    Idempotently create/update the site's admin (staff) account.

    Runs safely on every deploy (see build.sh): if the account already
    exists it just makes sure it's still staff/active, it never creates
    duplicates. Username/password can be overridden with the
    ADMIN_USERNAME / ADMIN_PASSWORD env vars without touching code.
    """

    help = "Ensure the admin login used by the site's Admin panel exists."

    def handle(self, *args, **options):
        username = os.environ.get('ADMIN_USERNAME', '988912')
        password = os.environ.get('ADMIN_PASSWORD', '988912')
        User = get_user_model()

        user, created = User.objects.get_or_create(
            username=username,
            defaults={'is_staff': True, 'is_superuser': True, 'is_active': True},
        )
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.set_password(password)
        user.save()

        action = 'Created' if created else 'Updated'
        self.stdout.write(self.style.SUCCESS(f"{action} admin account '{username}'."))
