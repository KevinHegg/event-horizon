# Event Horizon Agent Notes

- Work from the repo root and keep changes scoped to the playable slice.
- Use `npm run dev`, `npm run build`, `npm run test`, and `npm run lint` as the main verification commands.
- Keep the game simulation deterministic: fixed 60 Hz steps, seeded `mulberry32`, and input events recorded with simulation timestamps.
- Treat PixiJS as the rendering layer only. Keep game state and replay logic in framework-light TypeScript modules.
- The logical playfield is `1080 x 1920` portrait and must scale to the viewport without distortion.
- GitHub Pages builds should use the `/event-horizon/` base path. Netlify builds should set `VITE_BASE_PATH=/`.
- Avoid committing generated build output, local OS files, credentials, or large binary artifacts other than the requested PDF report.
