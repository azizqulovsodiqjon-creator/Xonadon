import json
import os
from unittest import mock

from django.core.cache import cache
from django.test import TestCase

from . import ai
from .models import Listing
from .tests import _login_as


def _listing(**kw):
    data = dict(title='Kvartira', price='50000', currency='ye', district='Jizzax shahri', lat=40.1, lng=67.8,
                type='Kvartira', type_key='kvartira', seller='seller', rooms=3, area=80, deal='sotuv')
    data.update(kw)
    return Listing.objects.create(**data)


class AiTestBase(TestCase):
    def setUp(self):
        cache.clear()
        cache.set('usd_uzs_rate', 12500.0, 3600)  # no call to cbu.uz
        self.env = mock.patch.dict(os.environ, {'OPENAI_API_KEY': 'sk-test'})
        self.env.start()
        self.addCleanup(self.env.stop)


class PriceEstimateTests(AiTestBase):
    def test_range_from_comparable_listings_in_the_same_district(self):
        for price in (48000, 50000, 52000, 54000, 56000):
            _listing(price=str(price), area=80)
        _listing(price='999999', area=80)  # outlier is dropped
        _listing(price='30000', area=80, district='Zomin tumani')  # other district not needed
        with mock.patch.object(ai, 'chat', return_value="O'xshash 5 ta e'lon asosida narx 50000–54000 y.e. Yakuniy narxni o'zingiz belgilaysiz.") as chat:
            r = self.client.post('/api/ai/price-estimate/', {'deal': 'sotuv', 'type_key': 'kvartira', 'rooms': 3, 'area': 80,
                                                            'district': 'Jizzax shahri', 'currency': 'ye', 'lang': 'uz'},
                                 content_type='application/json')
        d = r.json()
        self.assertTrue(d['enough'])
        self.assertEqual(d['level'], 'district')
        self.assertEqual(d['count'], 5)
        self.assertEqual(d['mid'], 52000)
        self.assertEqual((d['low'], d['high']), (50000, 54000))
        self.assertEqual(d['perM2'], 650)
        self.assertIn('Yakuniy narxni', d['explanation'])
        self.assertIn('"comparable_listings": 5', chat.call_args.args[0][1]['content'])

    def test_explanation_with_invented_number_is_dropped(self):
        for price in (48000, 50000, 52000):
            _listing(price=str(price))
        with mock.patch.object(ai, 'chat', return_value="Narx 77777 dollar bo'ladi."):
            d = self.client.post('/api/ai/price-estimate/', {'deal': 'sotuv', 'type_key': 'kvartira', 'rooms': 3, 'area': 80,
                                                            'district': 'Jizzax shahri'}, content_type='application/json').json()
        self.assertTrue(d['enough'])
        self.assertIsNone(d['explanation'])

    def test_too_few_listings_gives_no_number(self):
        _listing(price='50000')
        d = self.client.post('/api/ai/price-estimate/', {'deal': 'sotuv', 'type_key': 'kvartira', 'area': 80},
                             content_type='application/json').json()
        self.assertFalse(d['enough'])
        self.assertNotIn('mid', d)

    def test_soum_prices_are_converted(self):
        for price in ('600000000', '625000000', '650000000'):
            _listing(price=price, currency='uzs')
        d = ai.estimate_price('sotuv', 'kvartira', 3, 80, 'Jizzax shahri', currency='ye')
        self.assertEqual(d['mid'], 50000)
        d2 = ai.estimate_price('sotuv', 'kvartira', 3, 80, 'Jizzax shahri', currency='uzs')
        self.assertEqual(d2['mid'], 625000000)

    def test_rent_uses_the_whole_price_not_per_square_metre(self):
        for price in ('300', '350', '400'):
            _listing(price=price, deal='ijara')
        d = ai.estimate_price('ijara', 'kvartira', 3, 80, 'Jizzax shahri')
        self.assertEqual(d['mid'], 350)
        self.assertIsNone(d['perM2'])


class DescribeTests(AiTestBase):
    def payload(self):
        return {'title': '3 xonali kvartira', 'type': 'Kvartira', 'deal': 'sotuv', 'rooms': 3, 'area': 80,
                'floor': '4/9', 'district': 'Jizzax shahri', 'repair': 'Evroremont', 'lang': 'uz'}

    def test_requires_login(self):
        r = self.client.post('/api/ai/describe/', self.payload(), content_type='application/json')
        self.assertEqual(r.status_code, 401)

    def test_writes_text_from_the_fields(self):
        _login_as(self.client, 'seller')
        text = "Jizzax shahrida 3 xonali, 80 m² kvartira sotiladi. Uy 9 qavatli, kvartira 4-qavatda. Evroremont qilingan."
        with mock.patch.object(ai, 'chat', return_value=text) as chat:
            r = self.client.post('/api/ai/describe/', self.payload(), content_type='application/json')
        self.assertEqual(r.json(), {'ok': True, 'text': text})
        self.assertIn('Uzbek', chat.call_args.args[0][0]['content'])

    def test_invented_numbers_are_rejected(self):
        _login_as(self.client, 'seller')
        with mock.patch.object(ai, 'chat', return_value="Metroga 500 metr, 2015-yilda qurilgan."):
            r = self.client.post('/api/ai/describe/', self.payload(), content_type='application/json')
        self.assertEqual(r.status_code, 502)

    def test_not_configured(self):
        _login_as(self.client, 'seller')
        with mock.patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            r = self.client.post('/api/ai/describe/', self.payload(), content_type='application/json')
        self.assertEqual(r.status_code, 503)

    def test_daily_limit(self):
        _login_as(self.client, 'seller')
        with mock.patch.dict(os.environ, {'AI_LIMIT_DESCRIBE': '1'}), mock.patch.object(ai, 'chat', return_value='3 xonali kvartira.'):
            self.assertEqual(self.client.post('/api/ai/describe/', self.payload(), content_type='application/json').status_code, 200)
            self.assertEqual(self.client.post('/api/ai/describe/', self.payload(), content_type='application/json').status_code, 429)


class AssistantTests(AiTestBase):
    def test_turns_a_message_into_filters_and_finds_listings(self):
        good = _listing(title='3 xonali Jizzax', price='45000', rooms=3)
        _listing(title='Qimmat', price='90000', rooms=3)
        _listing(title='Boshqa tuman', price='40000', rooms=3, district='Zomin tumani')
        _listing(title='Sotilgan', price='42000', rooms=3, sold=True)
        answer = json.dumps({'intent': 'search', 'deal': 'sotuv', 'type_key': 'kvartira', 'rooms_min': 3, 'rooms_max': 3,
                             'price_max': 50000, 'currency': 'usd', 'district': 'Jizzax shahri'})
        with mock.patch.object(ai, 'chat', return_value=answer):
            d = self.client.post('/api/ai/assistant/', {'message': 'Jizzaxda 3 xonali kvartira 50 ming dollargacha', 'lang': 'uz'},
                                 content_type='application/json').json()
        self.assertTrue(d['ok'])
        self.assertEqual([x['id'] for x in d['listings']], [good.id])
        self.assertIn('1 ta', d['reply'])

    def test_general_question_gets_a_short_answer(self):
        with mock.patch.object(ai, 'chat', return_value=json.dumps({'intent': 'question', 'answer': "Ipoteka uchun bankka murojaat qiling."})):
            d = self.client.post('/api/ai/assistant/', {'message': 'Ipotekani qanday olaman?'}, content_type='application/json').json()
        self.assertEqual(d['listings'], [])
        self.assertIn('bankka', d['reply'])


class ModerationTests(AiTestBase):
    def setUp(self):
        super().setUp()
        self.sync = mock.patch.dict(os.environ, {'AI_REVIEW_SYNC': '1'})
        self.sync.start()
        self.addCleanup(self.sync.stop)

    def test_rules_and_openai_moderation_flag_a_listing(self):
        flagged = {'results': [{'flagged': True, 'categories': {'harassment': True, 'violence': False}}]}
        with mock.patch.object(ai, 'post_json', return_value=flagged) as pj:
            l = _listing(desc="Oldindan to'lov qiling, t.me/fake_kanal ga yozing")
        l.refresh_from_db()
        self.assertEqual(l.ai_review['status'], 'flagged')
        reasons = ' | '.join(l.ai_review['reasons'])
        self.assertIn('havola', reasons)
        self.assertIn("Oldindan to'lov", reasons)
        self.assertIn('Haqorat', reasons)
        self.assertEqual(pj.call_args.args[0], '/moderations')

    def test_clean_listing_is_ok_and_not_rechecked_without_changes(self):
        clean = {'results': [{'flagged': False, 'categories': {}}]}
        with mock.patch.object(ai, 'post_json', return_value=clean) as pj:
            l = _listing(desc="Yaxshi kvartira, hamma sharoitlari bor.")
            l.views_count = 5
            l.save()
        l.refresh_from_db()
        self.assertEqual(l.ai_review['status'], 'ok')
        self.assertEqual(pj.call_count, 1)

    def test_admin_sees_and_clears_flagged_listings(self):
        from django.contrib.auth.models import User
        with mock.patch.object(ai, 'post_json', return_value={'results': [{'flagged': False}]}):
            l = _listing(title='ARZON KVARTIRA SOTILADI SHOSHILING')
        admin = User.objects.create_user('admin', password='x', is_staff=True)
        self.client.force_login(admin)
        items = self.client.get('/api/admin/ai-reviews/').json()
        self.assertEqual([i['id'] for i in items], [l.id])
        self.assertTrue(self.client.post(f'/api/admin/ai-reviews/{l.id}/decide/', {'decision': 'ok'}, content_type='application/json').json()['ok'])
        self.assertEqual(self.client.get('/api/admin/ai-reviews/').json(), [])

    def test_non_admin_cannot_see_reviews(self):
        self.assertIn(self.client.get('/api/admin/ai-reviews/').status_code, (401, 403))

    def test_review_is_not_in_the_public_listing_api(self):
        with mock.patch.object(ai, 'post_json', return_value={'results': [{'flagged': False}]}):
            l = _listing()
        d = self.client.get(f'/api/listings/{l.id}/').json()
        self.assertNotIn('ai_review', d)


class StatusTests(AiTestBase):
    def test_status(self):
        self.assertTrue(self.client.get('/api/ai/status/').json()['configured'])
        with mock.patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            d = self.client.get('/api/ai/status/').json()
        self.assertFalse(d['configured'])
        self.assertTrue(d['features']['price'])
