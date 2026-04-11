FROM python:3.11-slim

WORKDIR /app

# Install git (needed for repo cloning)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create data directories
RUN mkdir -p /data/clones /data/graphs

ENV DATA_DIR=/data
ENV PORT=8100
# Optional: set to a local path containing a pre-downloaded fastembed model
# to enable vector embeddings without outbound network access.
# Example: AXON_EMBEDDING_MODEL_DIR=/data/models
# When unset, embeddings are disabled and no external downloads occur.
# ENV AXON_EMBEDDING_MODEL_DIR=

EXPOSE 8100

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8100/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
