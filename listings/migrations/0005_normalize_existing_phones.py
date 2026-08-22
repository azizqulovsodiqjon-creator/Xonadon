import re

from django.db import migrations


def normalize_phone(raw):
    digits = re.sub(r'\D', '', str(raw or ''))
    if digits.startswith('998') and len(digits) > 9:
        digits = digits[-9:]
    return digits


def normalize_phones(apps, schema_editor):
    Profile = apps.get_model('listings', 'Profile')
    seen = {}
    for p in Profile.objects.order_by('id'):
        norm = normalize_phone(p.phone)
        if not norm or norm == p.phone:
            seen.setdefault(norm, p.id)
            continue
        if norm in seen:
            # Another (older) profile already normalizes to this same
            # number - don't silently merge/delete either row, just leave
            # this one as-is and flag it for a human to look at.
            print(f"[normalize_phones] SKIPPED profile id={p.id} phone={p.phone!r} "
                  f"-> {norm!r} collides with existing profile id={seen[norm]}. "
                  f"Review manually.")
            continue
        p.phone = norm
        p.save(update_fields=['phone'])
        seen[norm] = p.id


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0004_message'),
    ]

    operations = [
        migrations.RunPython(normalize_phones, migrations.RunPython.noop),
    ]
