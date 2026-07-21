# OpenCubee2 UI

> A high-speed video retrieval cockpit for AIC-style frame hunting, temporal search, and team submissions.

![OpenCubee2 workbench](public/readme/image.png)

OpenCubee2 is a React + Vite + Tailwind command center for finding the one frame hiding inside a mountain of video: text queries, image queries, OCR, ASR, temporal stages, clustering, ambiguity mode, frame context, video preview, and team handoff.

## Why It Goes Hard

- Multi-stage temporal search: stack stages to describe a sequence instead of a single moment.
- Hybrid query inputs: text, image upload, Google image seeding, OCR filters, ASR filters, and query enhancement.
- Teamwork panel: push frames into a shared submission strip through WebSocket updates.
- Trake panel: pin comparison frames while searching.
- Frame actions everywhere: zoom, context, quick image search, video preview, lock video, drag frames.
- Themes with attitude: normal, dark, purple, blue, neon, random, and Jujutsu Kaisen mode.
- Browser history-style workspace restore for fast back/forward search iteration.

## Stack

```txt
React 19
Vite 8
Tailwind CSS 3
react-hot-toast
Font Awesome icons via CDN
FastAPI-style backend expected at localhost:21081
```

## Quick Start

```bash
npm install
npm run dev -- --port 21080
```

Open:

```txt
http://localhost:21080
```

Build:

```bash
npm run build
```

## Local Nginx Deploy

Build the production UI and serve it with Nginx on the same local port:

```bash
docker compose up --build
```

Open:

```txt
http://localhost:21080
```

Lint:

```bash
npm run lint
```

## Backend Tunnel

The frontend defaults to:

```txt
http://localhost:21081
```

For the shared backend, create the tunnel:

```bash
ssh -L 21081:localhost:2108 nguyenmv@192.168.20.156
```

Override the backend when needed:

```bash
VITE_BACKEND_BASE_URL=http://localhost:21081 npm run dev -- --port 21080
```

The WebSocket URL is derived from the same backend base URL, so REST and live updates stay pointed at the same server.

## Keyframes

Frame images are expected under:

```txt
public/keyframes
```

Host them separately when needed:

```bash
npx http-server "public\keyframes" -p 8081 --cors -c31536000
```

If the frame host is somewhere else:

```bash
VITE_ASSET_BASE_URL=http://localhost:8081 npm run dev -- --port 21080
```

## Project Map

```txt
src/
  App.jsx                         global app state, search flow, WebSocket, history
  api.js                          backend client
  main.jsx                        React entry
  index.css                       Tailwind, themes, animation system
  utils/imageUrl.js               frame URL resolver
  components/
    TopToolbar.jsx                theme, filters, history, global controls
    LeftSearchPanel.jsx           Google images, stages, search controls
    StageCard.jsx                 text/image/OCR/ASR/enhance query unit
    RightResultsPanel.jsx         teamwork, trake, results, frame actions
    modals/                       username, help, object filter, video, context
```

## Power Controls

| Action | Shortcut / Gesture |
| --- | --- |
| Search from a stage | `Enter` |
| Toggle enhance | `Ctrl + E` |
| Search history back / forward | `Ctrl + Left` / `Ctrl + Right` |
| Browser-style restore | `Alt + Left` / `Alt + Right` |
| Toggle OCR | `Alt + T` |
| Toggle ASR | `Alt + Y` |
| Toggle text/image mode | `Alt + I` |
| Add / remove stage | `Alt + +` / `Alt + -` |
| Reset workspace | `Alt + R` |
| Push hovered frame to team | `Ctrl + Space` |
| Open frame context | `Ctrl` / `Cmd` click |
| Quick image search from frame | `Ctrl` / `Cmd` + `Shift` click |
| Lock a video | `Alt` click |
| Preview video | right click a frame |

## Search Flow

1. Enter a text query or switch a stage to image mode.
2. Add OCR and ASR constraints when the target moment has visible text or spoken words.
3. Add more stages for temporal search.
4. Toggle cluster or ambiguous mode when the hunt calls for it.
5. Hit Search, inspect frames, open context, preview video, or push candidates to Teamwork.

## Notes

- `public/keyframes/` can be huge and should not be committed.
- `sessionStorage` keeps username and workspace history.
- `localStorage` keeps the selected theme.
- No test framework is configured; `npm run lint` is the available automated check.
- The screenshot above was captured from the live Vite UI and lives at `public/readme/opencubee2-workbench.png`.

## The Vibe

OpenCubee2 is built for the frantic last-mile of video search: fast keyboard moves, dense visual evidence, team handoff, and enough theme drama to make the scoreboard sweat.
