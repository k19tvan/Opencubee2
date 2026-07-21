# AGENTS.md — OpenCubee2 UI

## What this is

React + Vite + Tailwind CSS frontend for a video search system. Connects to a Python backend (FastAPI) on `localhost:2108` via HTTP and WebSocket. No test framework, no TypeScript, no CI pipeline.

## Commands

```bash
npm install          # install deps
npm run dev -- --port 21080  # start dev server (default: 0.0.0.0:5173)
npm run build        # production build → dist/
npm run lint         # ESLint (flat config, no TypeScript rules)
```

No test, typecheck, or format commands exist. Lint is the only automated check.

## Backend connectivity

- **API base URL**: hardcoded `http://localhost:21081` in `src/api.js:3`
- **WebSocket**: `ws://127.0.0.1:2108/ws` when running on ports 21080/5173 (`src/App.jsx:16`)
- **Production**: uses protocol-relative URLs based on `window.location.host`
- **SSH tunnel required**: `ssh -L 21081:localhost:2108 nguyenmv@192.168.20.152`

## Keyframe images

- Served from `public/keyframes/` (gitignored — must be downloaded separately)
- `public/keyframes.jsonl` and `public/keyframes_manifest.jsonl` are checked in and define available frames
- Image URLs built by `src/utils/imageUrl.js` — uses `VITE_ASSET_BASE_URL` env var or defaults to `/keyframes`
- Host a separate static server: `npx http-server "public\keyframes" -p 8081 --cors -c31536000`

## Architecture

```
src/
├── main.jsx              # React root
├── App.jsx               # All state, WebSocket, search logic, history (single-file god component)
├── api.js                # HTTP client → backend endpoints
├── utils/imageUrl.js     # Keyframe URL builder
├── index.css             # Tailwind + theme CSS variables (dark/light/judge)
└── components/
    ├── TopToolbar.jsx
    ├── LeftSearchPanel.jsx
    ├── RightResultsPanel.jsx
    ├── StageCard.jsx
    └── modals/            # UsernameModal, ObjectFilterModal, VideoPreviewModal, FrameContextModal, HelpModal
```

## Conventions

- **JSX only** — no `.tsx` files, no TypeScript
- **Tailwind utility classes** everywhere; custom theme via CSS variables (`--bg-primary`, `--accent-primary`, etc.)
- **Three themes**: dark (default), light, judge — toggled via CSS class on root div
- **Custom Tailwind tokens** in `tailwind.config.js`: colors (`darkBlue`, `cardBg`), animations (`fadeIn`, `shimmer`, `float`, `pulseGlow`), timing functions (`smooth`, `spring`, `out-expo`)
- **Keyboard shortcuts** defined in `App.jsx` — Ctrl+Arrow for search history, Alt+Arrow for browser history, Alt+T/Y/I/+/−/R for toggles, Alt+Click for lock video
- **Session storage** for username and workspace history; **local storage** for theme preference
- Vietnamese comments appear in some files — keep them if editing those files

## Gotchas

- `App.jsx` is ~830 lines and owns nearly all state/logic. Components are thin wrappers.
- Image upload uses `FormData` with `fetch`, not Axios
- `getImageUrl()` in `src/utils/imageUrl.js` is kept separate to preserve Vite Fast Refresh — do not inline it back into App.jsx
- `public/keyframes/` is gitignored but hundreds of `.webp` files exist locally — do not commit them
- No `.env` file exists by default. Set `VITE_ASSET_BASE_URL` only if using an external image host
