import base64
import io
import os
from unittest import mock

from django.test import RequestFactory, TestCase, override_settings
from PIL import Image

from . import social
from .models import Listing, ListingImage, Profile, SiteSetting


def _photo_data_url(w, h):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), (90, 120, 150)).save(buf, 'JPEG')
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def _make_listing(photos=2, **extra):
    listing = Listing.objects.create(
        title="3 xonali kvartira", price='52000', currency='ye', district='Jizzax shahri',
        lat=40.12, lng=67.84, type='Kvartira', type_key='kvartira', seller='ali', rooms=3, area=78,
        **extra)
    for _ in range(photos):
        ListingImage.objects.create(listing=listing, image=_photo_data_url(900, 1200))
    return listing


def _run_inline(tag, fn, *args):
    fn(*args)


@override_settings(SITE_BASE_URL='https://example.test')
@mock.patch.object(social, '_in_background', _run_inline)
class InstagramPostTests(TestCase):
    def setUp(self):
        self.calls = []

        def fake_ig(method, path, params):
            self.calls.append((method, path, params))
            if 'refresh_access_token' in path:
                return {'access_token': 'refreshed-token'}
            if path == 'me':
                return {'user_id': 777}
            if path.endswith('/media_publish'):
                return {'id': 'MEDIA1'}
            if path.endswith('/media'):
                return {'id': f'C{len(self.calls)}'}
            return {'status_code': 'FINISHED'}

        patcher = mock.patch.object(social, '_ig_call', side_effect=fake_ig)
        patcher.start()
        self.addCleanup(patcher.stop)

    @mock.patch.dict(os.environ, {'INSTAGRAM_ACCESS_TOKEN': 'seed-token'})
    def test_carousel_posted_and_saved(self):
        listing = _make_listing(photos=2)
        social.publish_new_listing(listing)

        listing.refresh_from_db()
        self.assertEqual(listing.ig_media_id, 'MEDIA1')
        media_posts = [p for m, path, p in self.calls if m == 'POST' and path == '777/media']
        self.assertEqual(len(media_posts), 3)  # 2 carousel items + the carousel itself
        self.assertEqual(media_posts[0]['image_url'], f'https://example.test/og/listing/{listing.id}/ig/0.jpg')
        self.assertEqual(media_posts[2]['media_type'], 'CAROUSEL')
        self.assertIn('52000 y.e', media_posts[2]['caption'])
        self.assertEqual(SiteSetting.get('ig_token'), 'refreshed-token')

    @mock.patch.dict(os.environ, {'INSTAGRAM_ACCESS_TOKEN': 'seed-token'})
    def test_not_posted_twice_or_without_photos(self):
        listing = _make_listing(photos=1)
        social.publish_new_listing(listing)
        listing.refresh_from_db()
        self.calls.clear()
        social.publish_new_listing(listing)
        social.publish_new_listing(_make_listing(photos=0))
        self.assertFalse([c for c in self.calls if c[1].endswith('/media')])

    def test_noop_without_token(self):
        with mock.patch.dict(os.environ, {'INSTAGRAM_ACCESS_TOKEN': ''}):
            social.publish_new_listing(_make_listing())
        self.assertEqual(self.calls, [])

    def test_instagram_image_endpoint_is_4_by_5(self):
        listing = _make_listing(photos=1)
        resp = self.client.get(f'/og/listing/{listing.id}/ig/0.jpg')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Image.open(io.BytesIO(resp.content)).size, social.IG_IMAGE_SIZE)
        self.assertEqual(self.client.get(f'/og/listing/{listing.id}/ig/5.jpg').status_code, 404)


@override_settings(SITE_BASE_URL='https://fallback.test', CSRF_TRUSTED_ORIGINS=['https://jizzaxjoy.test'])
@mock.patch.dict(os.environ, {'SITE_BASE_URL': '', 'RENDER_EXTERNAL_URL': ''})
class BaseUrlTests(TestCase):
    def test_follows_trusted_request_origin(self):
        request = RequestFactory().get('/', HTTP_HOST='jizzaxjoy.test', secure=True)
        self.assertEqual(social.base_url_for(request), 'https://jizzaxjoy.test')

    def test_forged_host_ignored(self):
        request = RequestFactory().get('/', HTTP_HOST='evil.example', secure=True)
        self.assertEqual(social.base_url_for(request), 'https://fallback.test')

    def test_explicit_env_wins(self):
        request = RequestFactory().get('/', HTTP_HOST='jizzaxjoy.test', secure=True)
        with mock.patch.dict(os.environ, {'SITE_BASE_URL': 'https://set.test'}), \
                override_settings(SITE_BASE_URL='https://set.test'):
            self.assertEqual(social.base_url_for(request), 'https://set.test')


class UploadCsrfTests(TestCase):
    """The site owner is logged into /panel/ in the same browser as they
    post listings - with a session, DRF enforces CSRF on every write."""

    def setUp(self):
        from django.contrib.auth.models import User
        from django.test import Client
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(User.objects.create_superuser('boss', password='x'))
        self.client.get('/')  # sets the csrftoken cookie, like a real page load
        self.token = self.client.cookies['csrftoken'].value

    def _upload(self, **headers):
        buf = io.BytesIO()
        Image.new('RGB', (40, 30), (1, 2, 3)).save(buf, 'JPEG')
        buf.seek(0)
        buf.name = 'p.jpg'
        return self.client.post('/api/listing-images/', {'images': buf}, **headers)

    def test_upload_without_token_is_rejected(self):
        resp = self._upload()
        self.assertEqual(resp.status_code, 403)
        self.assertIn(b'CSRF', resp.content)

    def test_upload_with_token_works(self):
        resp = self._upload(HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['ok'])


class PasswordAuthTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()  # login/sign-up rate limit counters live in the cache

    def _register(self, **overrides):
        data = {'full_name': 'Ali Valiyev', 'phone': '+998 90 123 45 67', 'password': 'uyjoy2026'}
        data.update(overrides)
        return self.client.post('/api/auth/simple-register/', data, content_type='application/json')

    def _login(self, phone, password):
        return self.client.post('/api/auth/login/', {'phone': phone, 'password': password},
                                content_type='application/json')

    def test_register_then_login_with_chosen_password(self):
        resp = self._register()
        self.assertEqual(resp.status_code, 201)
        self.assertNotIn('loginCode', resp.json())
        profile = Profile.objects.get(phone='901234567')
        self.assertTrue(profile.password_hash.startswith('pbkdf2_sha256$300000$'))
        self.assertNotIn('uyjoy2026', profile.password_hash)

        ok = self._login('901234567', 'uyjoy2026')  # any phone format works
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()['profile']['id'], profile.id)
        self.assertNotIn('password_hash', ok.json()['profile'])
        self.assertEqual(self._login('+998901234567', 'wrong-pass').status_code, 400)
        self.assertEqual(self._login('+998911111111', 'uyjoy2026').status_code, 400)

    def test_short_password_and_duplicate_phone_rejected(self):
        self.assertEqual(self._register(password='123').status_code, 400)
        self.assertEqual(self._register().status_code, 201)
        dup = self._register(full_name='Boshqa Odam')
        self.assertEqual(dup.status_code, 409)
        self.assertIn('Kirish', dup.json()['error'])

    def test_legacy_code_account_logs_in_with_code(self):
        from .views import _hash_login_code
        Profile.objects.create(phone='901112233', username='eski', full_name='Eski User',
                               login_code_hash=_hash_login_code('K7M2X9PQ'))
        self.assertEqual(self._login('+998 90 111 22 33', 'k7m2-x9pq').status_code, 200)
        self.assertEqual(self._login('+998 90 111 22 33', 'K7M2-X9PA').status_code, 400)

    def test_profile_without_credentials_is_claimed_by_registering(self):
        old = Profile.objects.create(phone='905554433', username='tg_user', full_name='')
        resp = self._register(phone='905554433', full_name='Yangi Ism')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['profile']['id'], old.id)
        self.assertEqual(self._login('905554433', 'uyjoy2026').status_code, 200)


@override_settings(SITE_BASE_URL='https://jizzax-joy.uz')
class SeoTests(TestCase):
    def test_sitemap_lists_every_listing_page(self):
        listing = _make_listing(photos=0)
        body = self.client.get('/sitemap.xml').content.decode()
        self.assertIn('<loc>https://jizzax-joy.uz/</loc>', body)
        self.assertIn(f'<loc>https://jizzax-joy.uz/elon/{listing.id}</loc>', body)

    def test_listing_page_has_its_own_title_and_canonical(self):
        listing = _make_listing(photos=0)
        # opened via the bare server IP - canonical must still be the domain
        body = self.client.get(f'/elon/{listing.id}', HTTP_HOST='46.101.249.199').content.decode()
        self.assertIn('<title>3 xonali kvartira - Jizzax-Joy</title>', body)
        self.assertIn(f'<link rel="canonical" href="https://jizzax-joy.uz/elon/{listing.id}">', body)
        self.assertNotIn('application/ld+json', body)

    def test_homepage_names_the_site(self):
        body = self.client.get('/').content.decode()
        self.assertIn("<title>Jizzax-Joy — uy-joy e'lonlari</title>", body)
        self.assertIn('<link rel="canonical" href="https://jizzax-joy.uz/">', body)
        self.assertIn('"name": "Jizzax-Joy"', body)


class ChannelPostCleanupTests(TestCase):
    def test_any_listing_deletion_removes_its_channel_post(self):
        from . import views
        listing = _make_listing(photos=0, tg_message_ids='101,102')
        with mock.patch.object(views, '_delete_listing_channel_posts') as delete_posts:
            listing.delete()
        delete_posts.assert_called_once()
        self.assertEqual(delete_posts.call_args.args[0].tg_message_ids, '101,102')

    @override_settings(TELEGRAM_BOT_TOKEN='t')
    @mock.patch.dict(os.environ, {'TELEGRAM_CHANNEL_ID': '@kanal'})
    def test_expired_listing_post_is_deleted_from_telegram(self):
        import datetime
        from django.utils import timezone
        from . import views
        listing = _make_listing(photos=0, tg_message_ids='555')
        Listing.objects.filter(pk=listing.pk).update(stage_started_at=timezone.now() - datetime.timedelta(days=30))
        with mock.patch.object(views, '_telegram_api') as tg, \
                mock.patch('threading.Thread', side_effect=lambda target, daemon: mock.Mock(start=target)):
            views.sweep_expired_listings()
        self.assertFalse(Listing.objects.filter(pk=listing.pk).exists())
        tg.assert_called_once_with('deleteMessage', chat_id='@kanal', message_id=555)


class SiteIconTests(TestCase):
    def test_favicon_is_a_real_icon_not_the_spa_page(self):
        ico = self.client.get('/favicon.ico')
        self.assertEqual(ico.status_code, 200)
        self.assertEqual(ico['Content-Type'], 'image/x-icon')
        png = self.client.get('/favicon-192.png')
        self.assertEqual(png['Content-Type'], 'image/png')
        self.assertEqual(Image.open(io.BytesIO(png.content)).size, (192, 192))
        page = self.client.get('/').content.decode()
        self.assertIn('<link rel="icon" href="/favicon.ico" sizes="48x48">', page)
        self.assertNotIn('Admin tasdiqlagan', page)
        self.assertNotIn('heroEyebrowText', page)  # the "To'g'ridan-to'g'ri egasidan..." chip
        self.assertNotIn('class="vip-sub"', page)
        self.assertNotIn('id="heroSub"', page)
        self.assertNotIn('heroSection', page)
        self.assertIn('<button class="pill-btn cta" id="postAdBtn">', page)


class InstallableAppTests(TestCase):
    def test_manifest_describes_an_installable_app(self):
        resp = self.client.get('/manifest.webmanifest')
        self.assertEqual(resp['Content-Type'], 'application/manifest+json')
        data = resp.json()
        self.assertEqual(data['display'], 'standalone')
        self.assertEqual(data['start_url'], '/')
        sizes = {(i['sizes'], i['purpose']) for i in data['icons']}
        self.assertIn(('512x512', 'maskable'), sizes)
        for icon in data['icons']:
            self.assertEqual(self.client.get(icon['src'])['Content-Type'], 'image/png')
        page = self.client.get('/').content.decode()
        self.assertIn('<link rel="manifest" href="/manifest.webmanifest">', page)
        self.assertIn("navigator.serviceWorker.register('/sw.js')", page)

    def test_service_worker_served_from_root(self):
        resp = self.client.get('/sw.js')
        self.assertEqual(resp['Content-Type'], 'application/javascript')
        self.assertIn("addEventListener('fetch'", resp.content.decode())

    def test_asset_links_empty_until_configured(self):
        with mock.patch.dict(os.environ, {'ANDROID_APP_PACKAGE': '', 'ANDROID_CERT_SHA256': ''}):
            self.assertEqual(self.client.get('/.well-known/assetlinks.json').json(), [])
        with mock.patch.dict(os.environ, {'ANDROID_APP_PACKAGE': 'uz.jizzaxjoy.app',
                                          'ANDROID_CERT_SHA256': 'aa:bb, CC:DD'}):
            data = self.client.get('/.well-known/assetlinks.json').json()
        self.assertEqual(data[0]['target']['package_name'], 'uz.jizzaxjoy.app')
        self.assertEqual(data[0]['target']['sha256_cert_fingerprints'], ['AA:BB', 'CC:DD'])
