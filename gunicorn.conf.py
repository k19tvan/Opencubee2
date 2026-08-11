"""Gunicorn configuration for the FastAPI backend."""

import os


bind = os.getenv("BACKEND_BIND", "0.0.0.0:2108")
workers = int(os.getenv("GUNICORN_WORKERS", "5"))
worker_class = "uvicorn.workers.UvicornWorker"

# Search and agent requests can take longer than the default Gunicorn timeout.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "1000"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "30"))

accesslog = "-"
errorlog = "-"
