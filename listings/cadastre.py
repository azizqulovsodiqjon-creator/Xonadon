"""
Cadastre ownership check for listings.

`lookup()` is the one place that talks to a cadastre data source. No
public cadastre API is known, so it returns None until CADASTRE_API_URL /
CADASTRE_API_KEY are configured *and* a client is written for the agreed
interface - until then every check goes to the admin queue. Once it
returns {'owner', 'address', 'area'} the match below is automatic.
"""
import re

from django.conf import settings
from django.utils import timezone

from .models import CadastreCheck, Listing

NUMBER_RE = re.compile(r'^\d{2}(:\d{1,4}){2,6}$')


def normalize_number(raw):
    return re.sub(r'\s+', '', str(raw or '')).replace('-', ':').replace('.', ':').strip(':')


def valid_number(number):
    return bool(NUMBER_RE.match(number))


def lookup(number):
    """Returns {'owner': str, 'address': str, 'area': float|None} or None
    when no cadastre data source is available."""
    if not (getattr(settings, 'CADASTRE_API_URL', '') and getattr(settings, 'CADASTRE_API_KEY', '')):
        return None
    # Write the client here once access to the cadastre data is granted.
    return None


def _tokens(name):
    name = re.sub(r"[ʻʼ`´']", '', str(name or '').lower())
    return {t for t in re.split(r'[^a-zа-яё0-9]+', name) if len(t) > 1}


def names_match(found, claimed):
    """Same person if every word of the shorter name appears in the other
    (handles 'Aliyev Vali' vs 'Vali Aliyev Ahmad o'g'li')."""
    a, b = _tokens(found), _tokens(claimed)
    if not a or not b:
        return False
    small, big = (a, b) if len(a) <= len(b) else (b, a)
    return len(small) >= 2 and small <= big


def run_check(listing, number, poster_name):
    """Creates/refreshes the listing's CadastreCheck and decides it: auto-
    approved when the cadastre owner matches the poster, else pending with
    a reason for the admin. Returns the CadastreCheck."""
    check, _ = CadastreCheck.objects.get_or_create(listing=listing, defaults={'cadastre_number': number})
    check.cadastre_number = number
    check.found_owner = check.found_address = ''
    check.found_area = None
    check.reviewed_at = None

    duplicate = (CadastreCheck.objects.filter(cadastre_number=number, listing__sold=False)
                 .exclude(listing=listing).exclude(listing__seller=listing.seller).exists())
    data = lookup(number)
    if duplicate:
        check.status, check.reason = 'pending', "Bu kadastr raqami boshqa foydalanuvchining e'lonida ham bor"
    elif data is None:
        check.status, check.reason = 'pending', "Kadastr bazasi ulanmagan - qo'lda tekshirish kerak"
    else:
        check.found_owner = data.get('owner', '')[:200]
        check.found_address = data.get('address', '')[:300]
        check.found_area = data.get('area')
        if names_match(check.found_owner, poster_name):
            check.status, check.reason = 'approved', ''
            check.reviewed_at = timezone.now()
        else:
            check.status, check.reason = 'pending', "Kadastrdagi egasi e'lon beruvchiga mos kelmadi"
    check.save()
    Listing.objects.filter(pk=listing.pk).update(ownership_verified=(check.status == 'approved'))
    return check
