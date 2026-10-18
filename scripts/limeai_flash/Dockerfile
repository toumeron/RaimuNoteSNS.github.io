FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_XET=1 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 LIMENOTE_SOURCE=/app/source
RUN apt-get update && apt-get install -y --no-install-recommends libopenblas0 liblapacke && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . ./
RUN python release_check.py && python download_model.py && useradd -m -u 1000 inference && chown -R inference:inference /app
USER inference
EXPOSE 8000
CMD ["python", "flash_cloud_server.py", "--host", "0.0.0.0", "--cpu"]
