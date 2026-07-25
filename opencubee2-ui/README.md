# OpenCubee2 UI

> A high-speed video retrieval cockpit for AIC-style frame hunting, temporal search, agent-assisted reasoning, and team submissions.

![OpenCubee2 workbench](public/readme/image.png)

OpenCubee2 is not a polite little search box. It is a React + Vite + Tailwind command center for finding the one frame hiding inside a mountain of video: text queries, image queries, OCR, ASR, temporal stages, clustering, ambiguity mode, frame context, video preview, team handoff, and an agent tab that can run its own search cycle.

## Why It Goes Hard

- Multi-stage temporal search: stack stages to describe a sequence instead of a single moment.
- Hybrid query inputs: text, image upload, Google image seeding, OCR filters, ASR filters, and query enhancement.
- Agent Search: launch a ReAct-style search run from the current query and watch logs, observations, candidates, and final matches.
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

## 🚀 Competition Setup: Hybrid Distributed Architecture (Highly Recommended)

During the competition, to avoid choking the local network when multiple team members fetch gigabytes of keyframes simultaneously, we recommend a Hybrid setup: **Centralized AI Backend + Local Keyframe Hosting**.

With this architecture:
- **Search, Translation & WebSocket (Teamwork):** Routes to the central GuestNAS server.
- **Keyframes (Thumbnails):** Loaded instantly from your local SSD.
- **Videos:** Streamed directly from the central server (as they are too large to distribute easily).

### Step 1: Prepare Local Keyframes
1. Copy all competition keyframe images directly into the UI's public folder: `opencubee2-ui/public/keyframes/`.
   > **Note:** The UI expects a flat directory structure. Ensure all `.webp` files are placed directly in `public/keyframes/` without subdirectories (or adjust `src/utils/imageUrl.js` if you prefer nested folders).
2. You do **not** need to run a separate static server! Vite will automatically serve these files for you.

### Step 2: Configure the Local UI
In your local `opencubee2-ui` folder, create a `.env.local` file to route traffic:

```env
# 1. Route AI Search & WebSocket to the central Server (Replace with actual Server IP)
VITE_BACKEND_BASE_URL=http://192.168.20.156:2108

# 2. Tell the browser to load frames from the local Vite server (public/keyframes)
VITE_ASSET_BASE_URL=/keyframes
```

### Step 3: Run the Local Client
Install dependencies and start the UI:
```bash
npm install
npm run dev -- --port 21080
```
Your UI will now load frames at lightning speed directly from your local `public/keyframes` folder, while still connecting to the shared Teamwork Panel on the central WebSocket!

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
    LeftSearchPanel.jsx           Google images, stages, agent/search buttons
    StageCard.jsx                 text/image/OCR/ASR/enhance query unit
    RightResultsPanel.jsx         teamwork, trake, results, frame actions
    AgentRunView.jsx              agent logs, observations, candidates, final match
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
6. Launch Agent Search when you want an autonomous pass with logs and candidate reasoning.

## Notes

- `public/keyframes/` can be huge and should not be committed.
- `sessionStorage` keeps username and workspace history.
- `localStorage` keeps the selected theme.
- No test framework is configured; `npm run lint` is the available automated check.
- The screenshot above was captured from the live Vite UI and lives at `public/readme/opencubee2-workbench.png`.

## The Vibe

OpenCubee2 is built for the frantic last-mile of video search: fast keyboard moves, dense visual evidence, team handoff, and enough theme drama to make the scoreboard sweat.
