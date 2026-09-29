"""
Auto-posting new listings to Instagram, alongside the existing Telegram
channel post (views._post_listing_to_channel). Same rules as that one:
best-effort, the network calls run in a background thread so creating a
listing is never delayed or broken by it, listings without photos are
skipped, and it's a no-op until INSTAGRAM_ACCESS_TOKEN is set (optional:
INSTAGRAM_USER_ID).

The listing's photos go up as one post (carousel for 2-10 photos) via the
Instagram API with Instagram Login. Instagram downloads the photos itself
from /og/listing/<id>/ig/<n>.jpg on this site.
"""
import base64
import io
import json
import os
import textwrap
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.db import close_old_connections

from .models import Listing, ListingImage, SiteSetting

IG_API = 'https://graph.instagram.com/v23.0'
IG_IMAGE_SIZE = (1080, 1350)  # 4:5 - Instagram rejects taller photos (most phone shots are 3:4)
IG_MAX_PHOTOS = 10


def _log(tag, msg):
    print(f'[{tag}] {msg}')


def base_url_for(request=None):
    """Public https origin of the site, used in captions and for the photo
    URLs Instagram downloads. An explicit SITE_BASE_URL env var wins;
    otherwise it's taken from the request the listing was created in, so
    it follows whatever domain the site is served on without extra config.
    That request origin is only trusted if it's in CSRF_TRUSTED_ORIGINS -
    ALLOWED_HOSTS is '*', so a forged Host header could otherwise point
    Instagram at someone else's server for the photos."""
    if os.environ.get('SITE_BASE_URL') or os.environ.get('RENDER_EXTERNAL_URL'):
        return settings.SITE_BASE_URL.rstrip('/')
    if request is not None:
        try:
            origin = f'{request.scheme}://{request.get_host()}'
        except Exception:
            origin = None
        trusted = [o.rstrip('/') for o in getattr(settings, 'CSRF_TRUSTED_ORIGINS', [])]
        if origin in trusted:
            return origin
    return settings.SITE_BASE_URL.rstrip('/')


def _listing_photos(listing_id, limit):
    """The listing's photos as raw JPEG bytes, oldest first."""
    photos = []
    for img in ListingImage.objects.filter(listing_id=listing_id).order_by('id')[:limit]:
        if img.image.startswith('data:') and ',' in img.image:
            try:
                photos.append(base64.b64decode(img.image.split(',', 1)[1]))
            except Exception:
                pass
    return photos


def _facts(listing, base):
    """Plain-text bits for the caption."""
    deal = {'sotuv': 'Sotiladi', 'ijara': 'Ijaraga', 'kunlik': 'Kunlik ijara'}.get(listing.deal, '')
    currency = {'ye': 'y.e', 'usd': 'USD', 'uzs': "so'm"}.get(listing.currency, '')
    details = []
    if listing.rooms:
        details.append(f'{listing.rooms} xona')
    if listing.area:
        details.append(f'{listing.area} m²')
    if listing.floor:
        details.append(f'{listing.floor}-qavat')
    return {
        'deal': deal,
        'price': f'{listing.price} {currency}'.strip(),
        'district': listing.district,
        'details': ', '.join(details),
        'link': f'{base}/elon/{listing.id}',
    }


HASHTAGS = '#jizzax #jizzaxjoy #uyjoy #kvartira #uysotiladi #ijara #недвижимость'


def _caption(listing, base):
    f = _facts(listing, base)
    lines = [listing.title]
    if f['deal']:
        lines.append(f['deal'])
    lines.append(f"💰 Narxi: {f['price']}")
    lines.append(f"📍 Hudud: {f['district']}")
    if f['details']:
        lines.append(f"🏠 {f['details']}")
    if listing.desc:
        lines.append('')
        lines.append(textwrap.shorten(listing.desc, 600, placeholder='...'))
    lines.append('')
    lines.append(f"Batafsil: {f['link']}")
    lines.append('')
    lines.append(HASHTAGS)
    return '\n'.join(lines)


# ---------------------------------------------------------------- images

def _fit_on_canvas(photo_bytes, size):
    """Photo scaled to fit inside `size` (nothing cropped), centered on a
    blurred, darkened, cover-scaled copy of itself."""
    from PIL import Image, ImageFilter, ImageEnhance, ImageOps

    img = ImageOps.exif_transpose(Image.open(io.BytesIO(photo_bytes))).convert('RGB')
    w, h = size
    bg = ImageOps.fit(img, size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
    bg = ImageEnhance.Brightness(bg).enhance(0.55)
    fg = img.copy()
    fg.thumbnail(size, Image.LANCZOS)
    bg.paste(fg, ((w - fg.width) // 2, (h - fg.height) // 2))
    return bg


def instagram_image_bytes(listing_id, index):
    """JPEG for the index-th photo, reshaped to Instagram's allowed 4:5
    frame. None if the listing/photo doesn't exist."""
    photos = _listing_photos(listing_id, IG_MAX_PHOTOS)
    if index < 0 or index >= len(photos):
        return None
    canvas = _fit_on_canvas(photos[index], IG_IMAGE_SIZE)
    buf = io.BytesIO()
    canvas.save(buf, format='JPEG', quality=88, optimize=True)
    return buf.getvalue()


# ------------------------------------------------------------- Instagram

def _ig_call(method, path, params):
    params = {k: v for k, v in params.items() if v is not None}
    url = f'{IG_API}/{path}' if not path.startswith('http') else path
    data = None
    if method == 'GET':
        url += '?' + urllib.parse.urlencode(params)
    else:
        data = urllib.parse.urlencode(params).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode('utf-8', 'replace')
        raise RuntimeError(f'{method} {path}: HTTP {exc.code} {body}') from None


def _instagram_token():
    """Current long-lived token. Seeded from INSTAGRAM_ACCESS_TOKEN (a new
    value there always wins, so pasting a fresh token into Render fixes an
    expired one), then refreshed weekly and kept in SiteSetting - tokens
    die after 60 days unless refreshed."""
    env_token = os.environ.get('INSTAGRAM_ACCESS_TOKEN', '').strip()
    if not env_token:
        return ''
    if SiteSetting.get('ig_token_seed') != env_token or not SiteSetting.get('ig_token'):
        SiteSetting.put('ig_token_seed', env_token)
        SiteSetting.put('ig_token', env_token)
        SiteSetting.put('ig_token_refreshed_at', '0')
    token = SiteSetting.get('ig_token')
    try:
        last = float(SiteSetting.get('ig_token_refreshed_at', '0') or 0)
    except ValueError:
        last = 0
    if time.time() - last > 7 * 24 * 3600:
        try:
            result = _ig_call('GET', 'https://graph.instagram.com/refresh_access_token',
                              {'grant_type': 'ig_refresh_token', 'access_token': token})
            if result.get('access_token'):
                token = result['access_token']
                SiteSetting.put('ig_token', token)
            SiteSetting.put('ig_token_refreshed_at', str(time.time()))
        except Exception as exc:
            # A token under 24h old can't be refreshed yet - harmless,
            # it's simply tried again on the next post.
            _log('instagram', f'token refresh skipped: {exc}')
    return token


def _instagram_user_id(token):
    uid = os.environ.get('INSTAGRAM_USER_ID', '').strip() or SiteSetting.get('ig_user_id')
    if not uid:
        uid = str(_ig_call('GET', 'me', {'fields': 'user_id', 'access_token': token})['user_id'])
        SiteSetting.put('ig_user_id', uid)
    return uid


def _ig_wait_ready(container_id, token, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = _ig_call('GET', container_id, {'fields': 'status_code', 'access_token': token}).get('status_code')
        if status == 'FINISHED':
            return
        if status in ('ERROR', 'EXPIRED'):
            raise RuntimeError(f'container {container_id} status {status}')
        time.sleep(3)
    raise RuntimeError(f'container {container_id} not ready after {timeout}s')


def _post_to_instagram(listing_id, base):
    listing = Listing.objects.filter(pk=listing_id).first()
    if not listing or listing.ig_media_id:
        return
    count = len(_listing_photos(listing_id, IG_MAX_PHOTOS))
    if not count:
        return
    token = _instagram_token()
    uid = _instagram_user_id(token)
    caption = _caption(listing, base)[:2200]
    urls = [f'{base}/og/listing/{listing_id}/ig/{i}.jpg' for i in range(count)]

    if count == 1:
        container = _ig_call('POST', f'{uid}/media', {
            'image_url': urls[0], 'caption': caption, 'access_token': token})['id']
    else:
        children = []
        for url in urls:
            children.append(_ig_call('POST', f'{uid}/media', {
                'image_url': url, 'is_carousel_item': 'true', 'access_token': token})['id'])
        for child in children:
            _ig_wait_ready(child, token)
        container = _ig_call('POST', f'{uid}/media', {
            'media_type': 'CAROUSEL', 'children': ','.join(children),
            'caption': caption, 'access_token': token})['id']
    _ig_wait_ready(container, token)
    media_id = _ig_call('POST', f'{uid}/media_publish', {
        'creation_id': container, 'access_token': token})['id']
    Listing.objects.filter(pk=listing_id).update(ig_media_id=str(media_id))
    _log('instagram', f'listing {listing_id} posted as {media_id}')


# ------------------------------------------------------------ public API

def _in_background(tag, fn, *args):
    def run():
        try:
            fn(*args)
        except Exception as exc:
            _log(tag, f'failed: {exc}')
        finally:
            close_old_connections()
    threading.Thread(target=run, daemon=True).start()


def publish_new_listing(listing, request=None):
    """Post a listing to Instagram unless it's already there.
    `request` is the one the listing came in on - see base_url_for()."""
    if listing.is_wanted:
        return  # "qidiryapman" requests have no photos of a property to show
    if os.environ.get('INSTAGRAM_ACCESS_TOKEN', '').strip() and not listing.ig_media_id:
        _in_background('instagram', _post_to_instagram, listing.id, base_url_for(request))
