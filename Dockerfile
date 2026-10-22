FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 WEB_CONCURRENCY=1 GUNICORN_THREADS=2
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m project
COPY . .
RUN mkdir -p /app/private && chown -R project:project /app
USER project
EXPOSE 5000
CMD ["sh","-c","python -c 'from app import app, initialize; ctx=app.app_context(); ctx.push(); initialize(); ctx.pop()' && gunicorn --bind 0.0.0.0:5000 --workers $WEB_CONCURRENCY --threads $GUNICORN_THREADS --timeout 120 app:app"]
