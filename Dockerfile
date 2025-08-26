# ---------- Stage 1: build static assets ----------
FROM node:20-alpine AS assets
WORKDIR /src

# Install deps
COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm i

# Copy configs + assets and build CSS
COPY postcss.config.js tailwind.config.js ./
COPY app/static ./app/static

# Skip asset build; rely on prebuilt app/static/css/harci.css in repo
RUN echo "Skipping CSS build (using precompiled harci.css)"

# ---------- Stage 2: python app ----------
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# OS deps (small layer)
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl \
  && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY app ./app

# Bring built CSS in (if Stage 1 produced it)
COPY --from=assets /src/app/static/css/harci.css ./app/static/css/harci.css

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
