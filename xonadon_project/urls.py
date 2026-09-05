from django.contrib import admin
from django.urls import path, re_path, include
from django.conf import settings
from django.conf.urls.static import static
from listings.views import index

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('listings.urls')),
    # Catch-all: the site is a client-side SPA that now updates the
    # address bar (history.pushState) for routes like /xarita or
    # /elon/42 without a real page reload - but a *direct* visit or a
    # browser refresh on one of those URLs still has to hit Django
    # first. Without this, that request 404s before script.js/the
    # router ever gets a chance to run. Kept LAST so it never shadows
    # a real route (api/, admin/, robots.txt, sitemap.xml, static/...)
    # above it.
    re_path(r'^.*$', index, name='spa-catchall'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)