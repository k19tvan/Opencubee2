"""Gunicorn configuration for the FastAPI backend."""

import os
import warnings


bind = os.getenv("BACKEND_BIND", "0.0.0.0:3108")
# Realtime collaboration state currently lives in process memory. Running more
# than one worker splits WebSocket clients and panel state between processes.
requested_workers = int(os.getenv("GUNICORN_WORKERS", "1"))
if requested_workers != 1:
    warnings.warn(
        "Forcing GUNICORN_WORKERS=1 because realtime collaboration state is process-local.",
        RuntimeWarning,
    )
workers = 1
worker_class = "uvicorn.workers.UvicornWorker"

# Search requests can take longer than the default Gunicorn timeout.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "1000"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "30"))

accesslog = "-"
errorlog = "-"
