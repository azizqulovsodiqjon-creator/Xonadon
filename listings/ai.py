"""
OpenAI helpers for Jizzax-Joy.

Four features, all optional (the site works without OPENAI_API_KEY):

1. price_estimate  - a market price range computed from comparable listings
                     already on the site (same deal/type, similar rooms/area,
                     same district first). Numbers never come from the AI;
                     it only explains them. The seller is free to ignore it.
2. describe        - writes the listing description from the form fields.
3. assistant       - buyers type what they want in plain words; the AI turns
                     it into filters and the server finds matching listings.
4. moderation      - every new/edited listing is checked in the background
                     (OpenAI moderation + simple rules); suspicious ones show
                     up in the admin panel's "AI tekshiruv" tab. Nothing is
                     deleted automatically.

Settings (environment):
    OPENAI_API_KEY         required for the AI parts
    OPENAI_TEXT_MODEL      default gpt-4o-mini
    OPENAI_BASE_URL        default https://api.openai.com/v1
    AI_LIMIT_DESCRIBE / AI_LIMIT_CHAT / AI_LIMIT_PRICE
                           per user (or per IP) per day
"""
import hashlib
import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request

from django.core.cache import cache
from django.db import close_old_connections
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response

from .models import Listing

DISTRICTS = [
    'Jizzax shahri', 'Arnasoy tumani', 'Baxmal tumani', "Do'stlik tumani", 'Forish tumani',
    "G'allaorol tumani", "Mirzacho'l tumani", 'Paxtakor tumani', 'Sh. Rashidov tumani',
    'Yangiobod tumani', 'Zafarobod tumani', 'Zarbdor tumani', 'Zomin tumani',
]
TYPE_KEYS = {'kvartira': 'Kvartira', 'hovli': 'Hovli/dacha', 'tijorat': 'Tijorat binolari', 'yer': 'Yer'}
DEALS = ('sotuv', 'ijara', 'kunlik')
LANG_NAMES = {'uz': 'Uzbek (Latin script)', 'ru': 'Russian', 'en': 'English'}
DEFAULT_LIMITS = {'describe': 20, 'chat': 60, 'price': 60}

NOT_CONFIGURED = "AI hozircha ulanmagan."


class AIError(Exception):
    pass


# ------------------------------------------------------------------ OpenAI plumbing
def api_key():
    return os.environ.get('OPENAI_API_KEY', '').strip()


def configured():
    return bool(api_key())


def _base():
    return os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')


def _text_model():
    return os.environ.get('OPENAI_TEXT_MODEL', 'gpt-4o-mini')


def _send(req, timeout):
    req.add_header('Authorization', f'Bearer {api_key()}')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode('utf-8', 'replace')[:500]
        raise AIError(f'OpenAI HTTP {exc.code}: {body}') from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise AIError(f'OpenAI unreachable: {exc}') from exc


def post_json(path, payload, timeout=60):
    req = urllib.request.Request(f'{_base()}{path}', data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    return _send(req, timeout)


def chat(messages, json_mode=False, max_tokens=500, temperature=0.3):
    payload = {'model': _text_model(), 'messages': messages, 'max_tokens': max_tokens, 'temperature': temperature}
    if json_mode:
        payload['response_format'] = {'type': 'json_object'}
    data = post_json('/chat/completions', payload)
    try:
        return (data['choices'][0]['message']['content'] or '').strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise AIError('Unexpected OpenAI answer') from exc


# ------------------------------------------------------------------ shared helpers
def _views():
    from . import views  # imported lazily: views is big and imports this app's models
    return views


def _lang(value):
    v = str(value or 'uz').lower()[:2]
    return v if v in LANG_NAMES else 'uz'


def _take_quota(request, kind, profile=None):
    """True if this user/IP may make one more `kind` request today."""
    limit = int(os.environ.get(f'AI_LIMIT_{kind.upper()}', DEFAULT_LIMITS[kind]))
    who = f'p{profile.id}' if profile else 'ip' + (request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
                                                    or request.META.get('REMOTE_ADDR', ''))
    key = f'ai:{kind}:{who}:{timezone.now().date().isoformat()}'
    used = cache.get(key, 0)
    if used >= limit:
        return False
    cache.set(key, used + 1, 60 * 60 * 26)
    return True


def _limit_response():
    return Response({'ok': False, 'error': "Bugungi AI limiti tugadi. Ertaga qayta urinib ko'ring."}, status=429)


def _numbers(text):
    return {round(float(n.replace(',', '.'))) for n in re.findall(r'\d+(?:[.,]\d+)?', str(text or ''))}


def grounded(text, allowed_text):
    """AI text may only contain numbers that appear in its input (or tiny ones like 1-3)."""
    allowed = _numbers(allowed_text) | {0, 1, 2, 3}
    return all(n in allowed for n in _numbers(text))


def parse_price(raw):
    """'45 000', '45000$', '45.000' -> 45000.0; ranges and junk -> None."""
    s = str(raw or '').strip()
    if not s or '-' in s.strip('-') or '–' in s:
        return None
    digits = re.sub(r'[^\d]', '', s)
    if not digits:
        return None
    value = float(digits)
    return value if value > 0 else None


def _to_usd(value, currency, rate):
    return value / rate if currency == 'uzs' else value


def _round_nice(value, currency):
    if currency == 'uzs':
        step = 1_000_000 if value >= 50_000_000 else 100_000 if value >= 2_000_000 else 10_000
    else:
        step = 1000 if value >= 50_000 else 100 if value >= 2000 else 10
    return int(round(value / step) * step)


def _quantile(sorted_vals, q):
    if not sorted_vals:
        return None
    pos = (len(sorted_vals) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def _drop_outliers(values):
    vals = sorted(values)
    if len(vals) < 5:
        return vals
    q1, q3 = _quantile(vals, 0.25), _quantile(vals, 0.75)
    iqr = q3 - q1
    return [v for v in vals if q1 - 1.5 * iqr <= v <= q3 + 1.5 * iqr]


# ------------------------------------------------------------------ status
@api_view(['GET'])
@permission_classes([AllowAny])
def ai_status(request):
    on = configured()
    return Response({'ok': True, 'configured': on,
                     'features': {'describe': on, 'assistant': on, 'price': True, 'priceExplain': on}})


# ------------------------------------------------------------------ 1. price estimate
def estimate_price(deal, type_key, rooms=None, area=0, district='', repair='', condition='', currency='ye', exclude_id=None):
    """Market range from comparable listings on the site. Returns a dict; `enough` is False
    when there are fewer than 3 comparable listings (then no number is given)."""
    rate = _views()._usd_uzs_rate()
    qs = Listing.objects.filter(deal=deal, type_key=type_key, is_wanted=False)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    comps = []
    for l in qs.only('id', 'title', 'price', 'currency', 'area', 'rooms', 'district', 'repair', 'condition', 'sold'):
        p = parse_price(l.price)
        if p is None:
            continue
        comps.append({'l': l, 'usd': _to_usd(p, l.currency, rate)})

    per_m2 = deal == 'sotuv' and (area or 0) > 0

    def value(c):
        if per_m2:
            return c['usd'] / c['l'].area if c['l'].area else None
        return c['usd']

    def near_rooms(c, spread):
        return rooms is None or c['l'].rooms is None or abs(c['l'].rooms - rooms) <= spread

    def near_area(c):
        return not area or not c['l'].area or 0.6 <= c['l'].area / area <= 1.6

    levels = [
        ('district', lambda c: c['l'].district == district and near_rooms(c, 1) and near_area(c)),
        ('region_similar', lambda c: near_rooms(c, 1) and near_area(c)),
        ('region_type', lambda c: True),
    ]
    chosen, level = [], None
    for name, test in levels:
        pool = [c for c in comps if test(c) and value(c)]
        vals = _drop_outliers([value(c) for c in pool])
        if len(vals) >= 3:
            chosen, level = [c for c in pool if value(c) in vals], name
            break
    if not chosen:
        return {'enough': False, 'count': len([c for c in comps if value(c)])}

    # Closer matches count more: same repair/condition get double weight in the median.
    weighted = []
    for c in chosen:
        times = 1 + int(bool(repair) and c['l'].repair == repair) + int(bool(condition) and c['l'].condition == condition)
        weighted += [value(c)] * times
    weighted.sort()
    mid, low, high = _quantile(weighted, 0.5), _quantile(weighted, 0.25), _quantile(weighted, 0.75)
    mult = area if per_m2 else 1
    out_cur = 'uzs' if currency == 'uzs' else 'ye'
    conv = (lambda v: v * rate) if out_cur == 'uzs' else (lambda v: v)
    n = len(chosen)
    confidence = 'high' if n >= 8 and level == 'district' else 'medium' if n >= 4 and level != 'region_type' else 'low'
    return {
        'enough': True,
        'count': n,
        'level': level,
        'confidence': confidence,
        'currency': out_cur,
        'low': _round_nice(conv(low * mult), out_cur),
        'mid': _round_nice(conv(mid * mult), out_cur),
        'high': _round_nice(conv(high * mult), out_cur),
        'perM2': _round_nice(conv(mid), out_cur) if per_m2 else None,
        'comparables': [{'id': c['l'].id, 'title': c['l'].title, 'price': c['l'].price, 'currency': c['l'].currency,
                         'area': c['l'].area, 'rooms': c['l'].rooms, 'district': c['l'].district, 'sold': c['l'].sold}
                        for c in sorted(chosen, key=lambda c: abs(value(c) - mid))[:5]],
    }


def _price_explanation(est, facts, lang):
    level_words = {'district': 'same district, similar size', 'region_similar': 'whole region, similar size',
                   'region_type': 'whole region, same property type'}
    payload = {**facts, 'comparable_listings': est['count'], 'match': level_words[est['level']],
               'range_low': est['low'], 'typical': est['mid'], 'range_high': est['high'],
               'currency': "so'm" if est['currency'] == 'uzs' else 'y.e. (USD)', 'confidence': est['confidence']}
    if est.get('perM2'):
        payload['typical_price_per_m2'] = est['perM2']
    text = chat([
        {'role': 'system', 'content': f"You help a real-estate seller in Jizzax, Uzbekistan. Answer in {LANG_NAMES[lang]}, "
                                      "2-3 short sentences, plain text. Use ONLY the numbers in the JSON. Say the range comes from "
                                      "similar listings on the site, and that the seller decides the final price."},
        {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)},
    ], max_tokens=220)
    return text if text and grounded(text, json.dumps(payload)) else None


@api_view(['POST'])
@permission_classes([AllowAny])
def price_estimate(request):
    d = request.data
    deal = d.get('deal') if d.get('deal') in DEALS else 'sotuv'
    type_key = d.get('type_key') if d.get('type_key') in TYPE_KEYS else 'kvartira'
    try:
        rooms = int(d.get('rooms')) if d.get('rooms') not in (None, '') else None
    except (TypeError, ValueError):
        rooms = None
    try:
        area = max(0, int(float(d.get('area') or 0)))
    except (TypeError, ValueError):
        area = 0
    district = d.get('district') if d.get('district') in DISTRICTS else ''
    currency = 'uzs' if d.get('currency') == 'uzs' else 'ye'
    profile = _views()._session_profile(request)
    if not _take_quota(request, 'price', profile):
        return _limit_response()
    est = estimate_price(deal, type_key, rooms, area, district, str(d.get('repair') or ''), str(d.get('condition') or ''),
                         currency, exclude_id=d.get('listing_id'))
    est['explanation'] = None
    if est['enough'] and configured():
        try:
            est['explanation'] = _price_explanation(est, {'deal': deal, 'type': TYPE_KEYS[type_key], 'rooms': rooms,
                                                          'area_m2': area or None, 'district': district or None},
                                                    _lang(d.get('lang')))
        except AIError as exc:
            print(f'[ai.price_estimate] {exc}')
    return Response({'ok': True, **est})


# ------------------------------------------------------------------ 2. description writer
@api_view(['POST'])
@permission_classes([AllowAny])
def describe(request):
    profile, error = _views()._require_profile(request)
    if error:
        return error
    if not configured():
        return Response({'ok': False, 'error': NOT_CONFIGURED}, status=503)
    if not _take_quota(request, 'describe', profile):
        return _limit_response()
    d = request.data
    clean = _views()._clean_text
    facts = {k: clean(d.get(k))[:200] for k in ('title', 'type', 'deal', 'rooms', 'area', 'floor', 'district', 'repair',
                                               'condition', 'price', 'currency') if str(d.get(k) or '').strip()}
    if d.get('mortgage') in (True, 'true', '1', 1):
        facts['mortgage'] = 'available'
    notes = clean(d.get('notes'))[:600]
    if notes:
        facts['owner_notes'] = notes
    if len(facts) < 2:
        return Response({'ok': False, 'error': "Avval asosiy ma'lumotlarni to'ldiring."}, status=400)
    lang = _lang(d.get('lang'))
    try:
        text = chat([
            {'role': 'system', 'content': f"Write a listing description for a real-estate site in Jizzax, Uzbekistan, in {LANG_NAMES[lang]}. "
                                          "4-6 short sentences, friendly and clear, plain text without emojis, markdown or hashtags. "
                                          "Use ONLY the facts given; never invent features, distances, documents or numbers. "
                                          "Do not include phone numbers or prices. Do not use words like 'best' or 'unique'."},
            {'role': 'user', 'content': json.dumps(facts, ensure_ascii=False)},
        ], max_tokens=400, temperature=0.5)
    except AIError as exc:
        print(f'[ai.describe] {exc}')
        return Response({'ok': False, 'error': "Matn yozib bo'lmadi. Keyinroq urinib ko'ring."}, status=502)
    text = clean(text).strip()
    if not text or not grounded(text, json.dumps(facts)):
        return Response({'ok': False, 'error': "AI noto'g'ri ma'lumot qo'shdi, qayta urinib ko'ring."}, status=502)
    return Response({'ok': True, 'text': text})


# ------------------------------------------------------------------ 3. assistant (search in plain words)
ASSISTANT_SYSTEM = (
    "You turn a home-seeker's message (Uzbek, Russian or English) into search filters for a real-estate site in "
    "Jizzax region, Uzbekistan. Reply with JSON only: "
    '{"intent": "search" | "question" | "other", "deal": "sotuv"|"ijara"|"kunlik"|null, '
    '"type_key": "kvartira"|"hovli"|"tijorat"|"yer"|null, "rooms_min": int|null, "rooms_max": int|null, '
    '"price_max": number|null, "price_min": number|null, "currency": "usd"|"uzs"|null, "district": string|null, '
    '"area_min": int|null, "mortgage": true|null, "repair": "Evroremont"|"O\'rtacha"|"Ta\'mirsiz"|null, '
    '"answer": string|null}. '
    "deal: sotuv = buy/sale, ijara = monthly rent, kunlik = daily rent. district must be one of: " + ", ".join(DISTRICTS)
    + ". Prices like '50 ming dollar' = 50000 usd, '3 mln so'm' = 3000000 uzs. For intent 'question' (a general question "
    "about buying/renting or using the site) put a short helpful answer (max 3 sentences, in the user's language) in "
    '"answer"; never invent listings, prices or laws.'
)


def search_listings(f, limit=6):
    qs = Listing.objects.filter(is_wanted=False, sold=False)
    if f.get('deal') in DEALS:
        qs = qs.filter(deal=f['deal'])
    if f.get('type_key') in TYPE_KEYS:
        qs = qs.filter(type_key=f['type_key'])
    if f.get('district') in DISTRICTS:
        qs = qs.filter(district=f['district'])
    for key, lookup in (('rooms_min', 'rooms__gte'), ('rooms_max', 'rooms__lte'), ('area_min', 'area__gte')):
        if isinstance(f.get(key), (int, float)) and f[key] > 0:
            qs = qs.filter(**{lookup: int(f[key])})
    if f.get('mortgage') is True:
        qs = qs.filter(mortgage=True)
    if f.get('repair'):
        qs = qs.filter(repair=f['repair'])
    rate = _views()._usd_uzs_rate()
    cur = 'uzs' if f.get('currency') == 'uzs' else 'usd'
    pmin = f.get('price_min') if isinstance(f.get('price_min'), (int, float)) else None
    pmax = f.get('price_max') if isinstance(f.get('price_max'), (int, float)) else None
    out = []
    for l in qs.order_by('-vip', '-top', '-created_at')[:200]:
        p = parse_price(l.price)
        if pmin or pmax:
            if p is None:
                continue
            usd = _to_usd(p, l.currency, rate)
            lo = _to_usd(pmin, cur, rate) if pmin else None
            hi = _to_usd(pmax, cur, rate) if pmax else None
            if (lo and usd < lo * 0.95) or (hi and usd > hi * 1.05):
                continue
        out.append(l)
        if len(out) >= limit:
            break
    return out


REPLIES = {
    'uz': {'found': "Sizning so'rovingizga mos {n} ta e'lon topdim:", 'none': "Afsuski, aynan shunday e'lon hozircha yo'q. Narx yoki tumanni kengaytirib ko'ring.",
           'other': "Men uy, kvartira, hovli va yer qidirishda yordam beraman. Masalan: \"Jizzax shahrida 3 xonali kvartira, 50 ming dollargacha\"."},
    'ru': {'found': "Нашёл {n} подходящих объявлений:", 'none': "Пока нет объявлений точно под ваш запрос. Попробуйте расширить цену или район.",
           'other': "Я помогаю искать квартиры, дома и землю. Например: «3-комнатная квартира в Джизаке до 50 000 $»."},
    'en': {'found': "I found {n} matching listings:", 'none': "No listing matches exactly yet. Try a wider price range or district.",
           'other': "I help you find apartments, houses and land. For example: \"3-room apartment in Jizzax city under $50,000\"."},
}


@api_view(['POST'])
@permission_classes([AllowAny])
def assistant(request):
    if not configured():
        return Response({'ok': False, 'error': NOT_CONFIGURED}, status=503)
    message = _views()._clean_text(request.data.get('message'))[:500].strip()
    if not message:
        return Response({'ok': False, 'error': "Xabar bo'sh."}, status=400)
    if not _take_quota(request, 'chat', _views()._session_profile(request)):
        return _limit_response()
    lang = _lang(request.data.get('lang'))
    history = request.data.get('history') if isinstance(request.data.get('history'), list) else []
    msgs = [{'role': 'system', 'content': ASSISTANT_SYSTEM}]
    for h in history[-6:]:
        if isinstance(h, dict) and h.get('role') in ('user', 'assistant') and isinstance(h.get('text'), str):
            msgs.append({'role': h['role'], 'content': h['text'][:500]})
    msgs.append({'role': 'user', 'content': message})
    try:
        raw = chat(msgs, json_mode=True, max_tokens=300, temperature=0)
        f = json.loads(raw)
        if not isinstance(f, dict):
            raise ValueError
    except (AIError, ValueError) as exc:
        print(f'[ai.assistant] {exc}')
        return Response({'ok': False, 'error': "Hozir javob bera olmadim. Keyinroq urinib ko'ring."}, status=502)
    r = REPLIES[lang]
    if f.get('intent') == 'question' and f.get('answer'):
        return Response({'ok': True, 'reply': _views()._clean_text(f['answer'])[:600], 'listings': [], 'filters': {}})
    if f.get('intent') != 'search':
        return Response({'ok': True, 'reply': r['other'], 'listings': [], 'filters': {}})
    found = search_listings(f)
    filters = {k: f.get(k) for k in ('deal', 'type_key', 'district', 'rooms_min', 'rooms_max', 'price_min', 'price_max',
                                     'currency', 'area_min', 'mortgage', 'repair') if f.get(k) not in (None, '', [])}
    return Response({
        'ok': True,
        'reply': r['found'].format(n=len(found)) if found else r['none'],
        'filters': filters,
        'listings': [{'id': l.id, 'title': l.title, 'price': l.price, 'currency': l.currency, 'district': l.district,
                      'rooms': l.rooms, 'area': l.area, 'deal': l.deal,
                      'image': f'/og/listing/{l.id}.jpg' if l.images.exists() else None} for l in found],
    })


# ------------------------------------------------------------------ 4. moderation
LINK_RE = re.compile(r'(https?://|www\.|t\.me/|\b[\w-]+\.(?:uz|com|ru|net|org)\b|@[A-Za-z]\w{3,})', re.I)
PHONE_RE = re.compile(r'(?:\+?998[\s-]?)?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}')
SCAM_RE = re.compile(r'(oldindan\s+to.?lov|avans\s+(o.?tkaz|yubor)|kartaga\s+(pul\s+)?(tashla|o.?tkaz)|предоплат|переведите\s+на\s+карт)', re.I)


def _review_source(listing):
    return hashlib.sha1(f'{listing.title}\n{listing.desc}\n{listing.price}\n{listing.currency}'.encode('utf-8')).hexdigest()


def rule_checks(listing):
    reasons = []
    text = f'{listing.title}\n{listing.desc}'
    if LINK_RE.search(text):
        reasons.append("Matnda havola yoki @username bor")
    if PHONE_RE.search(listing.desc or ''):
        reasons.append("Tavsifda telefon raqami yozilgan")
    if SCAM_RE.search(text):
        reasons.append("Oldindan to'lov so'ralmoqda (firibgarlik belgisi)")
    letters = re.findall(r'[A-Za-zА-Яа-я]', listing.title or '')
    if len(letters) >= 12 and sum(c.isupper() for c in letters) / len(letters) > 0.8:
        reasons.append("Sarlavha butunlay katta harflarda")
    if re.search(r'(.)\1{5,}', text):
        reasons.append("Bir xil belgi ko'p takrorlangan (spam)")
    if listing.desc and len(listing.desc) > 30 and Listing.objects.filter(desc=listing.desc).exclude(pk=listing.pk).exclude(seller=listing.seller).exists():
        reasons.append("Tavsif boshqa sotuvchining e'loni bilan bir xil")
    if not listing.is_wanted and parse_price(listing.price):
        est = estimate_price(listing.deal, listing.type_key, listing.rooms, listing.area, listing.district,
                             currency=listing.currency if listing.currency == 'uzs' else 'ye', exclude_id=listing.pk)
        price = parse_price(listing.price)
        if est['enough'] and est['count'] >= 5 and est['mid']:
            ratio = price / est['mid']
            if ratio < 0.3:
                reasons.append("Narx o'xshash e'lonlardan juda past (firibgarlik bo'lishi mumkin)")
            elif ratio > 3:
                reasons.append("Narx o'xshash e'lonlardan juda yuqori (xato bo'lishi mumkin)")
    return reasons


MOD_CATEGORIES = {'harassment': 'Haqorat', 'hate': 'Nafrat', 'sexual': 'Odobsiz', 'violence': "Zo'ravonlik",
                  'self-harm': "O'ziga zarar", 'illicit': 'Noqonuniy'}


def ai_checks(listing):
    reasons = []
    text = f'{listing.title}\n{listing.desc}'[:4000]
    data = post_json('/moderations', {'model': 'omni-moderation-latest', 'input': text}, timeout=30)
    result = (data.get('results') or [{}])[0]
    if result.get('flagged'):
        cats = [k for k, v in (result.get('categories') or {}).items() if v]
        names = sorted({MOD_CATEGORIES.get(c.split('/')[0], c) for c in cats})
        reasons.append("Nojo'ya matn: " + ', '.join(names) if names else "Nojo'ya matn")
    return reasons


def review_listing(listing_id):
    listing = Listing.objects.filter(pk=listing_id).first()
    if not listing:
        return
    src = _review_source(listing)
    current = listing.ai_review or {}
    if current.get('_src') == src:
        return
    # A full save of an older in-memory copy can wipe the stored review; reuse it instead of checking again.
    cached = cache.get(f'ai_review:{listing_id}:{src}')
    if cached:
        Listing.objects.filter(pk=listing_id).update(ai_review=cached)
        return
    reasons = rule_checks(listing)
    if configured():
        try:
            reasons += ai_checks(listing)
        except AIError as exc:
            print(f'[ai.review] listing {listing_id}: {exc}')
    review = {'_src': src, 'status': 'flagged' if reasons else 'ok', 'reasons': reasons, 'checked_at': timezone.now().isoformat()}
    Listing.objects.filter(pk=listing_id).update(ai_review=review)
    cache.set(f'ai_review:{listing_id}:{src}', review, 60 * 60 * 24)


def review_in_background(listing_id):
    def run():
        try:
            review_listing(listing_id)
        except Exception as exc:
            print(f'[ai.review] listing {listing_id} failed: {exc}')
        finally:
            close_old_connections()
    if os.environ.get('AI_REVIEW_SYNC') == '1':
        review_listing(listing_id)
    else:
        threading.Thread(target=run, daemon=True).start()


@receiver(post_save, sender=Listing)
def _review_saved_listing(sender, instance, update_fields=None, **kwargs):
    # Test runs only review when a test asks for it (no background threads, no network).
    if 'test' in sys.argv and os.environ.get('AI_REVIEW_SYNC') != '1':
        return
    if update_fields is not None and not ({'title', 'desc', 'price', 'currency'} & set(update_fields)):
        return
    if (instance.ai_review or {}).get('_src') != _review_source(instance):
        review_in_background(instance.pk)


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_ai_reviews(request):
    items = Listing.objects.filter(ai_review__status='flagged').order_by('-created_at')[:200]
    return Response([{'id': l.id, 'title': l.title, 'seller': l.seller, 'price': l.price, 'currency': l.currency,
                      'district': l.district, 'desc': l.desc[:300], 'reasons': (l.ai_review or {}).get('reasons', []),
                      'checkedAt': (l.ai_review or {}).get('checked_at'), 'createdAt': l.created_at} for l in items])


@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_ai_review_decide(request, listing_id):
    listing = Listing.objects.filter(pk=listing_id).first()
    if not listing:
        return Response({'ok': False, 'error': "E'lon topilmadi."}, status=404)
    decision = request.data.get('decision')
    if decision == 'ok':
        review = dict(listing.ai_review or {})
        review.update({'status': 'cleared', 'cleared_at': timezone.now().isoformat()})
        Listing.objects.filter(pk=listing_id).update(ai_review=review)
        if review.get('_src'):
            cache.set(f"ai_review:{listing_id}:{review['_src']}", review, 60 * 60 * 24)
        return Response({'ok': True})
    if decision == 'delete':
        listing.delete()
        return Response({'ok': True})
    return Response({'ok': False, 'error': "Noto'g'ri qaror."}, status=400)
