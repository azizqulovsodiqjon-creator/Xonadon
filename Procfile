web: python manage.py migrate --no-input && gunicorn xonadon_project.wsgi:application --workers 2 --threads 4 --worker-class gthread --timeout 90 --keep-alive 5
