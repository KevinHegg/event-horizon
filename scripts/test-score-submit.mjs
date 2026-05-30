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

const response = await scoreSubmit(
  new Request('https://event-horizon.test/.netlify/functions/score-submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(replay)
  })
);

const body = await response.json();
if (response.status !== 200 || !body.ok || body.score !== replay.score) {
  console.error(JSON.stringify({ status: response.status, body }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: response.status, body }, null, 2));
