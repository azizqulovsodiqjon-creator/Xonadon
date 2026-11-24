from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0032_uzpayment_receipt'),
    ]

    operations = [
        migrations.AddField(
            model_name='uzpayment',
            name='rejected_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
