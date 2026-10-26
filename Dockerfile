FROM python:3.12-slim-trixie
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 WEB_CONCURRENCY=1 GUNICORN_THREADS=2 PHB_OCR_IMAGE=deu-eng-poppler-2026-10
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update -o APT::Update::Error-Mode=any \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils postgresql-client-17 \
    && command -v tesseract && command -v pdftoppm \
    && tesseract --list-langs 2>&1 | grep -qx deu \
    && tesseract --list-langs 2>&1 | grep -qx eng \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m project
COPY . .
RUN mkdir -p /app/private && chown -R project:project /app
USER project
RUN python ocr_runtime.py --check
EXPOSE 5000
CMD ["sh","-c","python ocr_runtime.py --check && python -c 'from app import app, initialize; ctx=app.app_context(); ctx.push(); initialize(); ctx.pop()' && exec gunicorn --bind 0.0.0.0:5000 --workers $WEB_CONCURRENCY --threads $GUNICORN_THREADS --timeout 120 app:app"]
