"""
Auto-posting new listings to Instagram and YouTube, alongside the existing
Telegram channel post (views._post_listing_to_channel). Same rules as that
one: best-effort, the slow network/video work runs in a background thread
so creating a listing is never delayed or broken by it, listings without
photos are skipped, and each platform is a no-op until its env vars are set.

Instagram  - the listing's photos as a post (carousel for 2-10 photos), via
             the Instagram API with Instagram Login. Instagram downloads the
             photos itself from /og/listing/<id>/ig/<n>.jpg on this site.
             Env: INSTAGRAM_ACCESS_TOKEN (+ optional INSTAGRAM_USER_ID).
YouTube    - a vertical Shorts slideshow rendered from the photos (price,
             district etc. drawn on each frame), uploaded via the YouTube
             Data API. Env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET,
             YOUTUBE_REFRESH_TOKEN (get the last one with
             `python manage.py youtube_auth`), optional YOUTUBE_PRIVACY.
"""
import base64
import io
import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.db import close_old_connections
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import Listing, ListingImage, SiteSetting

IG_API = 'https://graph.instagram.com/v23.0'
IG_IMAGE_SIZE = (1080, 1350)  # 4:5 - Instagram rejects taller photos (most phone shots are 3:4)
IG_MAX_PHOTOS = 10

YT_FRAME_SIZE = (720, 1280)   # vertical 9:16 -> treated as a Short
YT_MAX_PHOTOS = 8
YT_SECONDS_PER_PHOTO = 3

# One video render at a time - ffmpeg + Pillow on a small host would run
# out of memory if several listings were posted at once.
_yt_lock = threading.Lock()


def _log(tag, msg):
    print(f'[{tag}] {msg}')


def _site_url():
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


def _facts(listing):
    """Shared plain-text bits for captions/descriptions/video frames."""
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
        'link': f'{_site_url()}/elon/{listing.id}',
    }


HASHTAGS = '#jizzax #jizzaxjoy #uyjoy #kvartira #uysotiladi #ijara #недвижимость'


def _caption(listing):
    f = _facts(listing)
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

def _fit_on_canvas(photo_bytes, size, bg_blur=True):
    """Photo scaled to fit inside `size` (nothing cropped), centered on a
    blurred, darkened, cover-scaled copy of itself."""
    from PIL import Image, ImageFilter, ImageEnhance, ImageOps

    img = ImageOps.exif_transpose(Image.open(io.BytesIO(photo_bytes))).convert('RGB')
    w, h = size
    if bg_blur:
        bg = ImageOps.fit(img, size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(28))
        bg = ImageEnhance.Brightness(bg).enhance(0.55)
    else:
        bg = Image.new('RGB', size, (18, 22, 30))
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


def _post_to_instagram(listing_id):
    listing = Listing.objects.filter(pk=listing_id).first()
    if not listing or listing.ig_media_id:
        return
    count = len(_listing_photos(listing_id, IG_MAX_PHOTOS))
    if not count:
        return
    token = _instagram_token()
    uid = _instagram_user_id(token)
    caption = _caption(listing)[:2200]
    urls = [f'{_site_url()}/og/listing/{listing_id}/ig/{i}.jpg' for i in range(count)]

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


# --------------------------------------------------------------- YouTube

_fallback_font_used = False


def _font(size, bold=False):
    global _fallback_font_used
    from PIL import ImageFont
    for name in (('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'),
                 ('LiberationSans-Bold.ttf' if bold else 'LiberationSans-Regular.ttf'),
                 ('arialbd.ttf' if bold else 'arial.ttf')):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    _fallback_font_used = True
    return ImageFont.load_default(size=size)


def _frame_text(text):
    """Pillow's built-in fallback font (used only when the host has no
    DejaVu/Liberation/Arial) lacks some glyphs - swap them for plain ones
    instead of drawing empty boxes."""
    if not _fallback_font_used:
        return text
    for a, b in (('²', '2'), ('•', '|'), ('‘', "'"), ('’', "'"), ('ʻ', "'"), ('ʼ', "'")):
        text = text.replace(a, b)
    return text


def _wrap(draw, text, font, max_width, max_lines):
    words, lines, line = text.split(), [], ''
    for word in words:
        trial = f'{line} {word}'.strip()
        if draw.textlength(trial, font=font) <= max_width:
            line = trial
            continue
        if line:
            lines.append(line)
        line = word
        if len(lines) == max_lines:
            break
    if line and len(lines) < max_lines:
        lines.append(line)
    if len(lines) == max_lines and ' '.join(lines) != ' '.join(words):
        lines[-1] = lines[-1].rstrip('.,') + '...'
    return lines


def _video_frame(photo_bytes, listing, facts, index, total):
    from PIL import ImageDraw

    w, h = YT_FRAME_SIZE
    frame = _fit_on_canvas(photo_bytes, (w, h))
    draw = ImageDraw.Draw(frame, 'RGBA')
    pad = 36

    # top: brand + deal type + photo counter
    draw.rectangle([0, 0, w, 110], fill=(0, 0, 0, 120))
    draw.text((pad, 34), 'Jizzax-Joy', font=_font(40, bold=True), fill=(255, 255, 255))
    if facts['deal']:
        deal_font = _font(26, bold=True)
        tw = draw.textlength(facts['deal'], font=deal_font)
        draw.rounded_rectangle([w - pad - tw - 28, 32, w - pad, 80], radius=22, fill=(253, 249, 14))
        draw.text((w - pad - tw - 14, 40), facts['deal'], font=deal_font, fill=(20, 20, 20))

    # bottom info card
    title_font, price_font, info_font = _font(38, bold=True), _font(54, bold=True), _font(30)
    title_lines = _wrap(draw, listing.title, title_font, w - 2 * pad, 2)
    info = [facts['district']] + ([facts['details']] if facts['details'] else [])
    card_h = 40 + len(title_lines) * 48 + 72 + len(info) * 42 + 70
    top = h - card_h - 40
    draw.rounded_rectangle([pad - 12, top, w - pad + 12, h - 40], radius=28, fill=(10, 14, 22, 205))
    y = top + 28
    for line in title_lines:
        draw.text((pad + 12, y), _frame_text(line), font=title_font, fill=(255, 255, 255))
        y += 48
    y += 8
    draw.text((pad + 12, y), facts['price'], font=price_font, fill=(253, 249, 14))
    y += 72
    for line in info:
        draw.text((pad + 12, y), _frame_text(line), font=info_font, fill=(215, 222, 235))
        y += 42
    domain = urllib.parse.urlparse(_site_url()).netloc or _site_url()
    draw.text((pad + 12, y + 12), _frame_text(f'{domain}  •  {index + 1}/{total}'), font=_font(26), fill=(150, 165, 190))
    return frame


def _ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


def render_listing_video(listing):
    """MP4 bytes of the listing's Shorts slideshow, or None without photos."""
    photos = _listing_photos(listing.id, YT_MAX_PHOTOS)
    if not photos:
        return None
    ffmpeg = _ffmpeg_exe()
    if not ffmpeg:
        raise RuntimeError('ffmpeg not found (pip install imageio-ffmpeg)')
    facts = _facts(listing)
    with tempfile.TemporaryDirectory() as tmp:
        for i, photo in enumerate(photos):
            _video_frame(photo, listing, facts, i, len(photos)).save(
                os.path.join(tmp, f'f{i:03d}.jpg'), quality=90)
        out = os.path.join(tmp, 'out.mp4')
        duration = len(photos) * YT_SECONDS_PER_PHOTO
        subprocess.run([
            ffmpeg, '-y', '-loglevel', 'error',
            '-framerate', f'1/{YT_SECONDS_PER_PHOTO}', '-i', os.path.join(tmp, 'f%03d.jpg'),
            # silent audio track - some players/apps treat audio-less
            # uploads oddly, and it costs nothing
            '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast',
            '-threads', '1', '-c:a', 'aac', '-shortest', '-t', str(duration),
            '-movflags', '+faststart', out,
        ], check=True, timeout=300)
        with open(out, 'rb') as fh:
            return fh.read()


def _youtube_configured():
    return all(os.environ.get(k, '').strip() for k in
               ('YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'))


def _youtube_access_token():
    data = urllib.parse.urlencode({
        'client_id': os.environ['YOUTUBE_CLIENT_ID'].strip(),
        'client_secret': os.environ['YOUTUBE_CLIENT_SECRET'].strip(),
        'refresh_token': os.environ['YOUTUBE_REFRESH_TOKEN'].strip(),
        'grant_type': 'refresh_token',
    }).encode('utf-8')
    with urllib.request.urlopen('https://oauth2.googleapis.com/token', data=data, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))['access_token']


def _youtube_metadata(listing):
    f = _facts(listing)
    title = f"{f['price']} - {listing.title}"
    if len(title) > 90:
        title = title[:87].rstrip() + '...'
    title += ' #Shorts'
    description = '\n'.join(filter(None, [
        listing.title,
        f['deal'],
        f"Narxi: {f['price']}",
        f"Hudud: {f['district']}",
        f['details'],
        '',
        textwrap.shorten(listing.desc, 1500, placeholder='...') if listing.desc else '',
        '',
        f"Batafsil va aloqa: {f['link']}",
        '',
        HASHTAGS + ' #shorts',
    ]))
    return {
        'snippet': {
            # YouTube rejects titles/descriptions containing < or >
            'title': title.replace('<', '').replace('>', ''),
            'description': description.replace('<', '').replace('>', '')[:4900],
            'tags': ['jizzax', 'uy-joy', 'kvartira', 'ko\'chmas mulk', 'Jizzax-Joy'],
            'categoryId': os.environ.get('YOUTUBE_CATEGORY_ID', '22'),
            'defaultLanguage': 'uz',
        },
        'status': {
            'privacyStatus': os.environ.get('YOUTUBE_PRIVACY', 'public'),
            'selfDeclaredMadeForKids': False,
        },
    }


def _upload_youtube_video(video, metadata, access_token):
    body = json.dumps(metadata).encode('utf-8')
    start = urllib.request.Request(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        data=body, method='POST', headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': 'video/mp4',
            'X-Upload-Content-Length': str(len(video)),
        })
    with urllib.request.urlopen(start, timeout=60) as resp:
        upload_url = resp.headers['Location']
    put = urllib.request.Request(upload_url, data=video, method='PUT', headers={
        'Authorization': f'Bearer {access_token}', 'Content-Type': 'video/mp4'})
    with urllib.request.urlopen(put, timeout=300) as resp:
        return json.loads(resp.read().decode('utf-8'))['id']


def _post_to_youtube(listing_id):
    with _yt_lock:
        listing = Listing.objects.filter(pk=listing_id).first()
        if not listing or listing.yt_video_id:
            return
        video = render_listing_video(listing)
        if not video:
            return
        video_id = _upload_youtube_video(video, _youtube_metadata(listing), _youtube_access_token())
        if not Listing.objects.filter(pk=listing_id).update(yt_video_id=video_id):
            # Sold/deleted while the video was rendering - don't leave an
            # orphan Short pointing at a dead listing.
            _delete_youtube_video(video_id)
        _log('youtube', f'listing {listing_id} uploaded as {video_id}')


def _delete_youtube_video(video_id):
    req = urllib.request.Request(
        'https://www.googleapis.com/youtube/v3/videos?' + urllib.parse.urlencode({'id': video_id}),
        method='DELETE', headers={'Authorization': f'Bearer {_youtube_access_token()}'})
    with urllib.request.urlopen(req, timeout=30):
        pass


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


def publish_new_listing(listing):
    """Post a listing to every configured platform it isn't on yet."""
    if listing.is_wanted:
        return  # "qidiryapman" requests have no photos of a property to show
    if os.environ.get('INSTAGRAM_ACCESS_TOKEN', '').strip() and not listing.ig_media_id:
        _in_background('instagram', _post_to_instagram, listing.id)
    if _youtube_configured() and not listing.yt_video_id:
        _in_background('youtube', _post_to_youtube, listing.id)


@receiver(post_delete, sender=Listing)
def remove_listing_posts(sender, instance, **kwargs):
    """Runs whenever a listing is deleted (sold, expired, removed). YouTube
    videos are deleted; the Instagram API has no delete call, so those
    posts stay until removed by hand in the app."""
    if instance.yt_video_id and _youtube_configured():
        _in_background('youtube', _delete_youtube_video, instance.yt_video_id)
