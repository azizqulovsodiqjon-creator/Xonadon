import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('listings', '0008_listing_likes_count_listing_sold_listing_views_count'),
    ]

    operations = [
        migrations.AlterField(
            model_name='listingimage',
            name='listing',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.CASCADE,
                related_name='images', to='listings.listing',
            ),
        ),
        migrations.AlterField(
            model_name='listingimage',
            name='image',
            field=models.TextField(),
        ),
        migrations.AddField(
            model_name='listingimage',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
    ]
