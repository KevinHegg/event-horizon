import { describe, expect, it } from 'vitest';
import scoreSubmit from '../netlify/functions/score-submit.mjs';

const replay = {
  version: 1,
  seed: 'eh-2026-05-29-alpha',
  startedAt: 1780051200000,
  survivalMs: 67421,
  score: 1280,
  energyCaptured: 87,
  maxStreak: 24,
  tapEvents: [],
  swipeEvents: [],
  phaseTransitions: []
};

describe('score-submit function', () => {
  it('accepts a valid replay payload', async () => {
    const response = await scoreSubmit(
      new Request('https://example.test/.netlify/functions/score-submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(replay)
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, score: 1280 });
  });

  it('rejects malformed replay payloads', async () => {
    const response = await scoreSubmit(
      new Request('https://example.test/.netlify/functions/score-submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false })
      })
    );
    expect(response.status).toBe(422);
  });
});
