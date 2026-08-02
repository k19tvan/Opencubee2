# AGENTS.md — OpenCubee2

Video-retrieval cockpit for the HCMAI competition. FastAPI backend + React/Vite/Tailwind UI.
One repo, two trees: `backend/` (tracked, Python) and `opencubee2-ui/` (React frontend). A repo-root
`.env` drives the backend; an `opencubee2-ui/.env` drives the UI.

## Layout & entry points

- `backend/main.py` — FastAPI app (`uvicorn backend.main:app`), port **2108**.
  - `backend/api/{agent,media,realtime,search}.py` — API routers.
  - `backend/core/{config,runtime}.py` — env loading + shared client singletons.
  - `backend/services/*.py` — retrieval/embedding/search logic.
  - `backend/schemas/*.py` — pydantic models.
- `backend_upgrading/` — untracked, byte-identical copy of `backend/`. It is **not independently runnable**:
  its files still `import from backend.*`, so `uvicorn backend_upgrading.main:app` would transparently
  pull in `backend/` modules. It is a staging copy only; edits there take no effect unless imports are
  rewritten or the dir replaces `backend/`.
- `opencubee2-ui/` — React/Vite UI (port 2408 via nginx, or 5173 via Vite dev).

## Run the backend

Run from the **repo root** (NOT from inside `backend/`). The README's `uvicorn main:app` run from
`backend/` is broken because `main.py` imports `from backend.api...`; the `backend` package is only
importable when CWD == repo root (and on `sys.path`).

```bash
cd /GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/Opencubee2
uvicorn backend.main:app --host 0.0.0.0 --port 2108
# or: python backend/main.py   (same entrypoint, includes startup_runtime)
```

`.env` lives at the repo root and is loaded by `backend/core/config.py` via `load_dotenv()`.
Missing `.env`? Copy `.env_example` — but note `.env_example` is stale: it omits
`VLLM_BASE_URL` and the `TEXT_PROCESSING_*` vars that `config.py`/`.env` use.

## Run / lint the UI

```bash
cd opencubee2-ui
npm run dev          # Vite, host 0.0.0.0; ignores public/keyframes in watch (huge dir)
npm run build        # production build
npm run lint         # ESLint only (eslint.config.js flat config)
docker compose up --build   # nginx serving dist on :2408 + keyframes volume
```

UI `.env` (in `opencubee2-ui/`) must set: `VITE_BACKEND_BASE_URL` (REST+WS origin) and
`VITE_ASSET_BASE_URL=/keyframes`. Without it the app falls back to `http://<host>:2108`.
For remote/tunnel dev set `VITE_BACKEND_BASE_URL=http://localhost:21081` after an SSH tunnel.

## External services the backend depends on at startup

`startup_runtime()` connects to (logs FATAL but keeps running if unreachable):
- Qdrant — gRPC 6334 / REST 6333 (host from `QDRANT_HOST`, default `opencubee2_qdrant`).
- Meilisearch — `MEILISEARCH_HOST` (default `http://opencubee2_meilisearch:7700`), index `OCR_ASR_INDEX_NAME`.
- Embedding workers — `BGE_WORKER_URL`(:2001), `BEIT3_WORKER_URL`(:2002),
  `METACLIP2_WORKER_URL`(:2003), `JINA_V5_OMNI_WORKER_URL`(:2004), each `POST .../embed`.
- Groq LLM — `GROQ_API_KEY` (qwen/qwen3.6-27b) for query enhancement.
- vLLM translator — `VLLM_BASE_URL` (qwen3-vl-4b) used as `llm_translate`.
- Tavily — `TAVILY_API_KEY` for the `/google_images` endpoint.
- `TEXT_PROCESSING_*` env block governs the OCR/ASR text-processing limits/timeout/cache.

If a service is down, the relevant feature degrades rather than the app crashing — check logs.

## Key paths (absolute on GuestNAS)

- Keyframes (backend `/keyframes/{frame_name}`): `IMAGE_BASE_PATH` =
  `/GuestShare_NAS/.../results/keyframes_beit3_096`. The UI nginx also serves them from
  `opencubee2-ui/public/keyframes/` (mounted read-only volume in docker-compose). Populate that dir
  with the `.webp`/`.jpg` keyframes — it is gitignored and large; Vite dev watch ignores it.
- Videos (`/videos/{video_id}`): `VIDEO_DIR` = `/mlcv1/Datasets/HCMAI25/full/`.
- Temp uploads: NAS `.../database/temp_uploads`, else local `./temp_uploads` (`.gitignored`).
- Agent canvases (`/agent/latest_canvas`): `/results/agent_canvases/`, else `./agent_canvases`.
- In-RAM caches loaded at startup: `results/similar_frames.json`, `results/frame_context.json`,
  plus `results/frame_context.sqlite` (fallback for `/check_temporal_frames`).

## Tooling / style notes

- **No Python tests, no Python lint/typecheck** wired up (ruff/mypy/mypy_cache/pytest_cache are only
  in `.gitignore`; no `pyproject.toml`/`requirements.txt`/`conftest.py`). `summary.py`/`summary.txt`
  at root are a one-off code-dump utility, gitignored — leave them alone.
- API style: JSON request bodies for `/search` (FormData when an image is uploaded), `/temporal_search`,
  `/enhance_query`, `/agent/start`. Results are paginated via `page`/`page_size`, RRF-fused across
  models, then clustered by contiguous `shot_id` per video.
- `backend_upgrading/services/search.py:34` has a stray `print("cc")` debug line — ignore/clean it.
- Branch convention observed: `feature/*`, `asr`, `server_dev`, `main`, `features/agent`.
