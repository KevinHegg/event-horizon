# Event Horizon

Event Horizon is a mobile-first cosmic chain-reaction game about delaying a galaxy's collapse into a black hole. The current slice is a plain Vite + PixiJS v8 site with deterministic simulation state kept outside the renderer.

## Current Slice

- Logical portrait playfield: `1080 x 1920`
- PixiJS canvas renderer with WebGL preference
- Fixed `60 Hz` simulation step decoupled from render frames
- Seeded `mulberry32` RNG and replay payloads from seed + input timings
- Default Pulse Chain mode: connect Dark Energy Nodes, press Play, and watch a Stabilizing Pulse travel the network
- Swipe-through-node chain drawing, tap-tap link placement, and tap-based node tuning
- Interactive `tutorial-001` first-run seed that teaches swipe chain, tap strategy, Play, stabilize taps, and Horizon Lens rescue
- Energy, Delay, Splitter, Conduit, and Source nodes with scoring and multiplier rules
- Energy nodes can be primed, Delay nodes cycle timing, and Splitters cycle output priority
- Pulse-phase taps stabilize arriving nodes for score and dark-energy gain
- Horizon Lens swipes during pulse playback create short-lived temporary bridges
- Path-based input recording with mobile Pointer Events and TouchEvent fallback
- First-run help overlay, tutorial hints, visible pulse/lens feedback, and debug hooks
- Bottom Collapse Meter, score/multiplier HUD, and stabilized/collapsed end states
- Share poster export from three captured gameplay frames
- Minimal Netlify score submit function that accepts legacy and Pulse Chain replay payloads
- Previous tether survival prototype remains available with `?mode=legacy`

## Assumptions

- The initial repo was empty, so this is a greenfield Vite scaffold.
- Custom deterministic motion is enough for the Pulse Chain slice; no Matter.js or Planck.js dependency is needed.
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
npm run capture:iteration-03
npm run report:iteration-03
npm run capture:iteration-04
npm run report:iteration-04
npm run capture:iteration-02
npm run report:iteration-02
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
  "mode": "pulse-chain",
  "seed": "tutorial",
  "startedAt": 1780185600000,
  "buildInputs": [
    {
      "t": 0,
      "kind": "chainSwipe",
      "nodeIds": [1, 2, 3],
      "path": [
        { "x": 250, "y": 1388, "t": 0 },
        { "x": 420, "y": 1165, "t": 90 },
        { "x": 635, "y": 1010, "t": 180 }
      ]
    },
    { "t": 300, "kind": "nodeTap", "nodeId": 4, "action": "splitter" },
    { "t": 620, "kind": "play" }
  ],
  "liveInputs": [
    { "t": 2200, "kind": "stabilize", "nodeId": 3, "rating": "stabilized", "success": true },
    {
      "t": 1600,
      "kind": "lens",
      "path": [
        { "x": 835, "y": 1215, "t": 0 },
        { "x": 700, "y": 1410, "t": 120 }
      ],
      "fromId": 6,
      "toId": 8,
      "success": true
    }
  ],
  "result": {
    "score": 620,
    "survivalMs": 12120,
    "maxMultiplier": 2,
    "loopsCompleted": 1,
    "linksUsed": 5,
    "bestChainLength": 5,
    "energyNodesHit": 2,
    "stabilized": false,
    "collapsed": false
  },
  "stepHash": "04ce9b1a"
}
```

Legacy mode still uses:

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

## Current Branch Workflow

```bash
git switch -c feat/iteration-04-playability-tap-swipe-strategy
git add .
git commit -m "Improve Event Horizon playability tutorial and strategy"
git push -u origin feat/iteration-04-playability-tap-swipe-strategy
gh pr create --base main --head feat/iteration-04-playability-tap-swipe-strategy --title "Improve Event Horizon playability tutorial and strategy" --body-file docs/iteration-04-report.md
```
