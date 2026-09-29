"""
One-time helper to get YOUTUBE_REFRESH_TOKEN for auto-posting Shorts.

Run it on your own computer (it opens a browser for the Google sign-in):

    set YOUTUBE_CLIENT_ID=...
    set YOUTUBE_CLIENT_SECRET=...
    python manage.py youtube_auth

Sign in with the Google account that owns the YouTube channel, allow
access, and copy the printed refresh token into Render's environment
variables as YOUTUBE_REFRESH_TOKEN. The OAuth client must be of type
"Desktop app" (it redirects back to 127.0.0.1 on your machine).
"""
import http.server
import json
import os
import urllib.parse
import urllib.request
import webbrowser

from django.core.management.base import BaseCommand, CommandError

PORT = 8765
REDIRECT_URI = f'http://127.0.0.1:{PORT}/'
# 'youtube' (not just 'youtube.upload') so sold listings' videos can be deleted too.
SCOPE = 'https://www.googleapis.com/auth/youtube'


class Command(BaseCommand):
    help = 'Sign in to YouTube once and print YOUTUBE_REFRESH_TOKEN'

    def handle(self, *args, **options):
        client_id = os.environ.get('YOUTUBE_CLIENT_ID', '').strip()
        client_secret = os.environ.get('YOUTUBE_CLIENT_SECRET', '').strip()
        if not client_id or not client_secret:
            raise CommandError('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET first.')

        auth_url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode({
            'client_id': client_id, 'redirect_uri': REDIRECT_URI, 'response_type': 'code',
            'scope': SCOPE, 'access_type': 'offline', 'prompt': 'consent',
        })
        received = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                received.update({k: v[0] for k, v in query.items()})
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write("Tayyor! Terminalga qayting.".encode('utf-8'))

            def log_message(self, *args):
                pass

        self.stdout.write('Brauzerda Google hisobingizga kiring va ruxsat bering:\n' + auth_url + '\n')
        webbrowser.open(auth_url)
        server = http.server.HTTPServer(('127.0.0.1', PORT), Handler)
        while 'code' not in received and 'error' not in received:
            server.handle_request()
        server.server_close()
        if 'error' in received:
            raise CommandError(f"Google refused: {received['error']}")

        data = urllib.parse.urlencode({
            'code': received['code'], 'client_id': client_id, 'client_secret': client_secret,
            'redirect_uri': REDIRECT_URI, 'grant_type': 'authorization_code',
        }).encode('utf-8')
        with urllib.request.urlopen('https://oauth2.googleapis.com/token', data=data, timeout=30) as resp:
            tokens = json.loads(resp.read().decode('utf-8'))
        refresh = tokens.get('refresh_token')
        if not refresh:
            raise CommandError(f'No refresh token in response: {tokens}')
        self.stdout.write(self.style.SUCCESS('\nYOUTUBE_REFRESH_TOKEN=' + refresh))
