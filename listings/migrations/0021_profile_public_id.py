import random

from django.db import migrations, models


def backfill_public_ids(apps, schema_editor):
    Profile = apps.get_model('listings', 'Profile')
    used = set(Profile.objects.exclude(public_id='').values_list('public_id', flat=True))
    for profile in Profile.objects.filter(public_id=''):
        while True:
            candidate = str(random.randint(100000, 999999))
            if candidate not in used:
                used.add(candidate)
                break
        profile.public_id = candidate
        profile.save(update_fields=['public_id'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0020_paymentevent_tierdiscount'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='public_id',
            field=models.CharField(blank=True, default='', max_length=6),
            preserve_default=False,
        ),
        migrations.RunPython(backfill_public_ids, noop_reverse),
        migrations.AlterField(
            model_name='profile',
            name='public_id',
            field=models.CharField(blank=True, max_length=6, unique=True),
        ),
    ]
