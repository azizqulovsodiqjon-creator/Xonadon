"""
Namunaviy (test) e'lonlarni elonlar.csv va images/ papkasidan bazaga qo'shadi.

  python manage.py seed_demo_listings --dir /yo'l/Jizzax            # qo'shish
  python manage.py seed_demo_listings --dir /yo'l/Jizzax --dry-run   # faqat tekshirish
  python manage.py seed_demo_listings --delete                       # namunaviylarni o'chirish

Namunaviy e'lonlar ig_media_id='demo-seed' belgisi bilan saqlanadi. Bu belgi ikki ish qiladi:
  1) social.missing_instagram_ids() ularni Instagram'ga avtomatik chiqarib yubormaydi;
  2) --delete faqat shularni topib o'chiradi (haqiqiy e'lonlarga tegmaydi).
Telegram kanalga ham chiqmaydi (u faqat ListingViewSet.create ichida ishlaydi).
"""
import base64
import csv
import os
import random
from datetime import timedelta
from io import BytesIO

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from listings.models import Listing, ListingImage

MARK = 'demo-seed'

# (lat, lng) - taxminiy markazlar, JIZZAX_BOUNDS ichida
CENTERS = {
    "Jizzax shahri": (40.1158, 67.8422), "Arnasoy": (40.55, 67.85), "Baxmal": (39.75, 68.05),
    "Do'stlik": (40.52, 68.03), "Forish": (40.12, 66.78), "G'allaorol": (40.03, 67.58),
    "Mirzacho'l": (40.45, 68.40), "Paxtakor": (40.30, 67.95), "Sharof Rashidov": (40.10, 67.25),
    "Yangiobod": (40.00, 68.20), "Zafarobod": (40.45, 68.15), "Zarbdor": (40.15, 68.15),
    "Zomin": (39.96, 68.40),
}
TYPE_LABEL = {"kvartira": "Kvartira", "hovli": "Hovli/dacha", "yer": "Yer"}
SELLERS = ["Aziz", "Dilshod", "Gulnora", "Jasur", "Malika", "Otabek", "Sevara", "Bekzod", "Nodira", "Sardor"]


def district_name(t):
    return "Jizzax shahri" if t == "Jizzax shahri" else ("Sh. Rashidov tumani" if t == "Sharof Rashidov" else f"{t} tumani")


def to_data_url(path):
    from PIL import Image
    img = Image.open(path).convert('RGB')
    img.thumbnail((int(os.environ.get('IMAGE_MAX_DIM', '900')),) * 2)
    buf = BytesIO()
    img.save(buf, format='JPEG', quality=int(os.environ.get('IMAGE_QUALITY', '70')), optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')


class Command(BaseCommand):
    help = "Namunaviy e'lonlarni CSV + rasmlardan qo'shadi yoki o'chiradi."

    def add_arguments(self, p):
        p.add_argument('--dir', help="elonlar.csv va images/ turgan papka")
        p.add_argument('--dry-run', action='store_true')
        p.add_argument('--delete', action='store_true', help="Avval qo'shilgan namunaviy e'lonlarni o'chiradi")

    def handle(self, *a, **o):
        if o['delete']:
            n, _ = Listing.objects.filter(ig_media_id=MARK).delete()
            self.stdout.write(f"O'chirildi (e'lon + rasmlar jami): {n}")
            return
        if not o['dir']:
            raise CommandError("--dir kerak")
        base = o['dir']
        rows = list(csv.DictReader(open(os.path.join(base, 'elonlar.csv'), encoding='utf-8-sig')))
        if Listing.objects.filter(ig_media_id=MARK).exists():
            raise CommandError("Namunaviy e'lonlar allaqachon bor. Avval: seed_demo_listings --delete")
        rng = random.Random(7)
        now = timezone.now()
        made = skipped = 0
        for r in rows:
            imgs = [os.path.join(base, r['rasm1']), os.path.join(base, r['rasm2'])]
            if not all(os.path.exists(x) for x in imgs):
                skipped += 1
                self.stdout.write(f"  rasm yo'q, o'tkazib yuborildi: #{r['id']}")
                continue
            if o['dry_run']:
                made += 1
                continue
            t = r['turi']
            lat0, lng0 = CENTERS[r['tuman']]
            built = t != 'yer'
            listing = Listing.objects.create(
                title=r['sarlavha'], desc=r['tavsif'], price=str(int(float(r['narx_usd']))), currency='usd',
                district=district_name(r['tuman']),
                lat=round(min(max(lat0 + rng.uniform(-.03, .03), 39.56), 40.74), 6),
                lng=round(min(max(lng0 + rng.uniform(-.03, .03), 66.26), 68.94), 6),
                rooms=int(r['xonalar']) if r['xonalar'] else None, area=int(float(r['maydon_m2'])),
                floor=r['qavat'], type=TYPE_LABEL[t], type_key=t,
                repair=rng.choice(["Evroremont", "O'rtacha", "Ta'mirsiz"]) if built else '',
                condition=rng.choice(["Ikkinchi qo'l", "Yangi bino"]) if built else '',
                phone='', seller=rng.choice(SELLERS), owner=True, deal='sotuv',
                views_count=rng.randint(5, 220), ig_media_id=MARK)
            Listing.objects.filter(pk=listing.pk).update(
                created_at=now - timedelta(days=rng.randint(0, 25), hours=rng.randint(0, 23)))
            for x in imgs:
                ListingImage.objects.create(listing=listing, image=to_data_url(x))
            made += 1
        self.stdout.write(self.style.SUCCESS(f"Tayyor: {made} ta e'lon{' (dry-run, yozilmadi)' if o['dry_run'] else ''}, o'tkazib yuborilgan: {skipped}"))
