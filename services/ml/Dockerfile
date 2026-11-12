# EcoShield ML service image.
# The YAMNet model files are NOT baked in: mount them read-only at /models, e.g.
#   docker run -e ML_API_TOKEN=... -v "$PWD/data/models:/models:ro" -p 127.0.0.1:8000:8000 ecoshield-ml:dev
FROM python:3.13.18-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

RUN pip install --no-cache-dir uv==0.13.7

WORKDIR /app

# Dependencies first, so code changes do not reinstall them. Exact versions come from uv.lock.
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

# Run as an unprivileged user.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin ml
USER ml

ENV PATH="/app/.venv/bin:${PATH}" \
    YAMNET_MODEL_PATH=/models/yamnet/yamnet_classification.tflite \
    YAMNET_CLASS_MAP=/models/yamnet/yamnet_class_map.csv

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
