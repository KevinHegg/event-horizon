## Summary

- Adds a plain Vite + PixiJS v8 vertical slice for Event Horizon.
- Implements deterministic 60 Hz simulation, seeded RNG, tap/swipe input capture, replay payloads, orb/flyby/shadow-arm gameplay, HUD, collapse animation, and poster export.
- Adds Netlify score-submit function, Google Apps Script fallback sample, README, AGENTS.md, tests, screenshots, and a PDF developer report.

## Tests

- `npm run build`
- `npm run lint`
- `npm run test`
- `npm run test:e2e`
- `npm run score:test`

## Notes

- Default Vite base path supports GitHub Pages at `/event-horizon/`.
- Netlify uses `VITE_BASE_PATH=/` through `netlify.toml`.
- Score persistence is intentionally deferred; the current endpoint validates and acknowledges replay payloads.
