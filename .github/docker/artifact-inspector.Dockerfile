FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

LABEL org.opencontainers.image.source="https://github.com/hideouts-io/hideouts.io-public"

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 tesseract-ocr libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*
