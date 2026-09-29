import base64
import io
import os
from unittest import mock

from django.test import RequestFactory, TestCase, override_settings
from PIL import Image

from . import social
from .models import Listing, ListingImage, SiteSetting


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


YT_ENV = {'YOUTUBE_CLIENT_ID': 'id', 'YOUTUBE_CLIENT_SECRET': 'secret', 'YOUTUBE_REFRESH_TOKEN': 'rt',
          'INSTAGRAM_ACCESS_TOKEN': ''}


@mock.patch.object(social, '_in_background', _run_inline)
@mock.patch.object(social, '_youtube_access_token', return_value='access')
@mock.patch.dict(os.environ, YT_ENV)
class YouTubePostTests(TestCase):
    def test_short_rendered_uploaded_and_deleted_with_listing(self, _token):
        listing = _make_listing(photos=2)
        with mock.patch.object(social, '_upload_youtube_video', return_value='VID1') as upload:
            social.publish_new_listing(listing)
        video, metadata, _ = upload.call_args.args
        self.assertTrue(video[4:8] == b'ftyp')  # a real MP4 came out of ffmpeg
        self.assertIn('#Shorts', metadata['snippet']['title'])
        listing.refresh_from_db()
        self.assertEqual(listing.yt_video_id, 'VID1')

        with mock.patch.object(social, '_delete_youtube_video') as delete:
            listing.delete()
        delete.assert_called_once_with('VID1')

    def test_wanted_listings_skipped(self, _token):
        with mock.patch.object(social, '_upload_youtube_video') as upload:
            social.publish_new_listing(_make_listing(is_wanted=True))
        upload.assert_not_called()


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
        with mock.patch.dict(os.environ, {'SITE_BASE_URL': 'https://set.test'}),                 override_settings(SITE_BASE_URL='https://set.test'):
            self.assertEqual(social.base_url_for(request), 'https://set.test')
