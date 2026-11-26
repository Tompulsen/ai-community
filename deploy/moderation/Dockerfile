# syntax=docker/dockerfile:1
FROM python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d AS build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /service
COPY services/moderation/requirements.txt ./
RUN python -m venv /venv && /venv/bin/pip install --no-cache-dir -r requirements.txt && /venv/bin/pip check
COPY services/moderation/ ./
RUN /venv/bin/python models.py /opt/models
RUN /venv/bin/python -m unittest -v test_service && /venv/bin/python smoke.py --models /opt/models

FROM python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d
ENV PATH=/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1 MODERATION_MODEL_DIR=/opt/models
RUN groupadd -g 10001 moderation && useradd --no-create-home -u 10001 -g 10001 moderation
COPY --from=build /venv/ /venv/
COPY --from=build /opt/models/ /opt/models/
COPY services/moderation/service.py services/moderation/models.py services/moderation/NOTICE.md services/moderation/APACHE-2.0.txt /service/
WORKDIR /service
USER 10001:10001
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4).close()"
CMD ["python", "service.py"]
