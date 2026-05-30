# Event Horizon

Event Horizon is a mobile-first, one-thumb casual survival prototype about delaying a galaxy's collapse into a black hole. The first vertical slice is a plain Vite + PixiJS v8 site with deterministic simulation state kept outside the renderer.

## Current Slice

- Logical portrait playfield: `1080 x 1920`
- PixiJS canvas renderer with WebGL preference
- Fixed `60 Hz` simulation step decoupled from render frames
- Seeded `mulberry32` RNG and replay payloads from seed + input timings
- Tap and swipe input recording
- Dark-energy orbs, tether capture, flyby bonuses, and shadow-arm hazards
- Phase-based black-hole visibility and gravity pressure
- Bottom dark-energy meter, score/time HUD, and collapse end animation
- Share poster export from three captured gameplay frames
- Minimal Netlify score submit function plus Google Apps Script sample

## Assumptions

- The initial repo was empty, so this is a greenfield Vite scaffold.
- Custom deterministic motion is enough for the vertical slice; no Matter.js or Planck.js dependency is needed yet.
- GitHub Pages is the public static target and uses `/event-horizon/` as the base path.
- Netlify deploys should set `VITE_BASE_PATH=/` through the included `netlify.toml`.
- The score function validates and acknowledges payloads only; durable storage is a backlog item.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test
npm run test:e2e
npm run score:test
npm run report:pdf
```

Local Vite serves the game at:

```text
http://127.0.0.1:5173/event-horizon/
```

## Deployment

### GitHub Pages

The default Vite base path is `/event-horizon/`, so `npm run build` produces static assets compatible with:

```text
https://kevinhegg.github.io/event-horizon/
```

### Netlify

`netlify.toml` uses:

```toml
[build]
  command = "VITE_BASE_PATH=/ npm run build"
  publish = "dist"

[functions]
  directory = "netlify/functions"
```

The score endpoint is available at:

```text
/.netlify/functions/score-submit
```

For local Netlify function routing, run Netlify CLI from the repo root:

```bash
npx netlify dev
```

## Replay Payload Shape

```json
{
  "version": 1,
  "seed": "eh-2026-05-29-alpha",
  "startedAt": 1780051200000,
  "survivalMs": 67421,
  "score": 1280,
  "energyCaptured": 87,
  "maxStreak": 24,
  "tapEvents": [],
  "swipeEvents": [],
  "phaseTransitions": []
}
```

## First PR Workflow

```bash
git switch -c feat/first-playable
git add .
git commit -m "Build first playable Event Horizon slice"
git push -u origin feat/first-playable
gh pr create --base main --head feat/first-playable --title "Build first playable Event Horizon slice" --body-file docs/pr-body.md
```
