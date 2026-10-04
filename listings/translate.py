"""
Machine translation of what users type into a listing (title + description),
so the site shows it in the visitor's language (UZ / RU / EN).

Uses the free MyMemory API (no key; ~5 000 characters a day anonymously, or
~50 000 with MYMEMORY_EMAIL set). Each listing is translated once - the
result lives in Listing.translations together with a hash of the text it
was made from - and again only if its title/description change. Runs in a
background thread so saving a listing never waits on it; if the daily quota
runs out, the listing simply shows its original text until a later retry.

Listing.translations looks like:
    {"_src": "<sha1 of title+desc>", "_lang": "uz",
     "ru": {"title": "...", "desc": "..."}, "en": {...}}
The source language has no entry - the original text is used for it.
"""
import hashlib
import html
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from django.db import close_old_connections
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Listing

LANGS = ('uz', 'ru', 'en')
API = 'https://api.mymemory.translated.net/get'
CHUNK = 450  # MyMemory rejects queries over 500 bytes-ish


class QuotaExceeded(Exception):
    pass


def detect_lang(text):
    """'ru' for Russian Cyrillic, otherwise 'uz' (Latin script, or Cyrillic
    using the Uzbek-only letters ў қ ғ ҳ)."""
    letters = re.findall(r'[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ]', text or '')
    if not letters:
        return 'uz'
    cyrillic = [c for c in letters if re.match(r'[А-Яа-яЁёЎўҚқҒғҲҳ]', c)]
    if len(cyrillic) / len(letters) > 0.5 and not re.search(r'[ЎўҚқҒғҲҳ]', text):
        return 'ru'
    return 'uz'


def _chunks(text):
    """Split into pieces under CHUNK chars, preferring sentence ends."""
    parts, cur = [], ''
    for sentence in re.split(r'(?<=[.!?])\s+', text.strip()):
        while len(sentence) > CHUNK:  # one very long sentence: cut at a space
            cut = sentence.rfind(' ', 0, CHUNK) or CHUNK
            parts.append(sentence[:cut])
            sentence = sentence[cut:].strip()
        if cur and len(cur) + 1 + len(sentence) > CHUNK:
            parts.append(cur)
            cur = sentence
        else:
            cur = (cur + ' ' + sentence).strip()
    if cur:
        parts.append(cur)
    return parts


def _call(text, src, dst):
    params = {'q': text, 'langpair': f'{src}|{dst}'}
    email = os.environ.get('MYMEMORY_EMAIL', '').strip()
    if email:
        params['de'] = email
    try:
        with urllib.request.urlopen(API + '?' + urllib.parse.urlencode(params), timeout=30) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code in (403, 429):
            raise QuotaExceeded() from None
        raise
    if data.get('quotaFinished') or str(data.get('responseStatus')) in ('403', '429'):
        raise QuotaExceeded()
    if str(data.get('responseStatus')) != '200':
        raise RuntimeError(f"MyMemory: {data.get('responseDetails')}")
    return html.unescape(data['responseData']['translatedText'])


def translate_text(text, src, dst):
    if not (text or '').strip():
        return ''
    return ' '.join(_call(piece, src, dst) for piece in _chunks(text))


def _source_hash(listing):
    return hashlib.sha1(f'{listing.title}\0{listing.desc}'.encode('utf-8')).hexdigest()


def needs_translation(listing):
    tr = listing.translations or {}
    return tr.get('_src') != _source_hash(listing)


def translate_listing(listing_id):
    listing = Listing.objects.filter(pk=listing_id).first()
    if not listing or not needs_translation(listing):
        return
    src = detect_lang(f'{listing.title} {listing.desc}')
    out = {'_src': _source_hash(listing), '_lang': src}
    for dst in LANGS:
        if dst != src:
            out[dst] = {'title': translate_text(listing.title, src, dst),
                        'desc': translate_text(listing.desc, src, dst)}
    # only if the text didn't change again while we were translating
    Listing.objects.filter(pk=listing_id, title=listing.title, desc=listing.desc).update(translations=out)


def translate_in_background(listing_id):
    def run():
        try:
            translate_listing(listing_id)
        except QuotaExceeded:
            print(f'[translate] daily quota used up - listing {listing_id} will be retried later')
        except Exception as exc:
            print(f'[translate] listing {listing_id} failed: {exc}')
        finally:
            close_old_connections()
    threading.Thread(target=run, daemon=True).start()


@receiver(post_save, sender=Listing)
def _translate_saved_listing(sender, instance, update_fields=None, **kwargs):
    # saves that only bump counters/tier/translations themselves don't matter
    if update_fields is not None and not ({'title', 'desc'} & set(update_fields)):
        return
    if needs_translation(instance):
        translate_in_background(instance.pk)


_last_retry = 0.0


def retry_missing(limit=3, every_seconds=900):
    """Called from a frequently-hit endpoint: picks up a few listings whose
    translation is missing or stale (e.g. after the daily quota ran out),
    at most once every 15 minutes."""
    global _last_retry
    now = time.time()
    if now - _last_retry < every_seconds:
        return
    _last_retry = now
    pending = [l.pk for l in Listing.objects.only('id', 'title', 'desc', 'translations') if needs_translation(l)]
    for pk in pending[:limit]:
        translate_in_background(pk)
