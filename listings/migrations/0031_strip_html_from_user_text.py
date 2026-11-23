from django.db import migrations

LISTING_TEXT_FIELDS = ('title', 'desc', 'price', 'district', 'floor', 'type', 'type_key',
                       'repair', 'condition', 'phone', 'owner_role')
PROFILE_TEXT_FIELDS = ('full_name', 'role')


def _strip(value):
    return value.replace('<', '').replace('>', '') if isinstance(value, str) else value


def strip_html(apps, schema_editor):
    """User text is put into the page as HTML; new input has '<'/'>'
    removed by the serializers, this cleans what was saved before."""
    for model_name, fields in (('Listing', LISTING_TEXT_FIELDS), ('Profile', PROFILE_TEXT_FIELDS)):
        Model = apps.get_model('listings', model_name)
        for obj in Model.objects.only('id', *fields).iterator():
            changed = [f for f in fields if _strip(getattr(obj, f)) != getattr(obj, f)]
            if changed:
                for f in changed:
                    setattr(obj, f, _strip(getattr(obj, f)))
                Model.objects.filter(pk=obj.pk).update(**{f: getattr(obj, f) for f in changed})


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0030_transfer_payment'),
    ]

    operations = [
        migrations.RunPython(strip_html, migrations.RunPython.noop),
    ]
