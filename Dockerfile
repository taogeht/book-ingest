# Marker needs PyTorch, which has flaky musl support. Use Debian-slim instead
# of node:alpine so apt + pip work without contortions.
FROM node:20-bookworm-slim AS base

# System deps:
#   python3 + venv + pip   — to run marker-pdf
#   poppler-utils          — pdftoppm for page-image rendering, plus a fallback
#                            pdftotext for the "is this digital?" probe
#   build-essential        — some pip wheels still compile from source
#   libgl1 / libglib2.0-0  — common transitive native deps (image/font stacks)
#   ca-certificates + git  — model downloads from huggingface, occasional git-clones in pip
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-venv \
      python3-pip \
      poppler-utils \
      build-essential \
      libgl1 \
      libglib2.0-0 \
      ca-certificates \
      git \
    && rm -rf /var/lib/apt/lists/*

# Isolate marker's Python deps in a venv so PEP 668 doesn't fight us.
ENV VIRTUAL_ENV=/opt/marker-venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Marker downloads its model weights to ~/.cache/huggingface on first run.
# Pin the location so it lands in a predictable layer.
ENV HF_HOME=/opt/hf-cache
ENV TRANSFORMERS_CACHE=/opt/hf-cache
ENV TORCH_HOME=/opt/torch-cache

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r /tmp/requirements.txt

# Pre-warm:
#   1. marker_single --help    sanity-check that the CLI is on PATH
#   2. create_model_dict()     actually pulls model weights from HF (~2GB).
#      Done at build time so the first ingest doesn't hang for ~5 min waiting
#      for downloads. Wrapped in `|| true` because the model factory API has
#      shifted across marker versions — if pre-warm fails, first ingest just
#      pays the download cost lazily and we'll fix the pin.
RUN marker_single --help > /dev/null \
 && python3 -c "from marker.models import create_model_dict; create_model_dict()" \
    || echo "marker model pre-warm failed (non-fatal — first ingest will download)"

# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app ./

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# `npm start` runs `drizzle-kit push --force && next start` — schema is
# applied on every boot.
CMD ["npm", "start"]
