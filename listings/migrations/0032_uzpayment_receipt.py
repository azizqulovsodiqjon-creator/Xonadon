from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0031_strip_html_from_user_text'),
    ]

    operations = [
        migrations.AddField(
            model_name='uzpayment',
            name='receipt',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='uzpayment',
            name='receipt_uploaded_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
