from django.db import models

class Listing(models.Model):
    DEAL_CHOICES = [
        ('sotuv', 'Sotuv'),
        ('ijara', 'Ijara'),
        ('kunlik', 'Kunlik'),
    ]

    title = models.CharField(max_length=255)
    desc = models.TextField(blank=True)
    price = models.CharField(max_length=50)
    district = models.CharField(max_length=100)
    lat = models.FloatField()
    lng = models.FloatField()
    rooms = models.IntegerField(null=True, blank=True)
    area = models.IntegerField(default=0)
    floor = models.CharField(max_length=50, blank=True)
    type = models.CharField(max_length=100)
    type_key = models.CharField(max_length=50)
    repair = models.CharField(max_length=100, blank=True)
    condition = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    seller = models.CharField(max_length=100)
    owner_role = models.CharField(max_length=100, default="Uy egasi")
    owner = models.BooleanField(default=True)
    mortgage = models.BooleanField(default=False)
    deal = models.CharField(max_length=20, choices=DEAL_CHOICES, default='sotuv')
    vip = models.BooleanField(default=False)
    top = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class ListingImage(models.Model):
    listing = models.ForeignKey(Listing, related_name='images', on_delete=models.CASCADE)
    image = models.ImageField(upload_to='listings/')

    def __str__(self):
        return f"{self.listing.title} - image"