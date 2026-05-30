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

const pulseReplay = {
  version: 1,
  mode: 'pulse-chain',
  seed: 'tutorial-002',
  startedAt: 1780185600000,
  buildInputs: [
    {
      t: 0,
      kind: 'chainSwipe',
      nodeIds: [1, 2, 3],
      path: [
        { x: 250, y: 1388, t: 0 },
        { x: 420, y: 1165, t: 90 },
        { x: 635, y: 1010, t: 180 }
      ]
    },
    { t: 300, kind: 'nodeTap', nodeId: 4, action: 'splitter' },
    { t: 620, kind: 'play' }
  ],
  liveInputs: [
    { t: 2200, kind: 'stabilize', nodeId: 3, rating: 'stabilized', success: true },
    {
      t: 1600,
      kind: 'lens',
      path: [
        { x: 835, y: 1215, t: 0 },
        { x: 700, y: 1410, t: 120 }
      ],
      fromId: 6,
      toId: 8,
      success: true
    }
  ],
  result: {
    score: 620,
    survivalMs: 12120,
    maxMultiplier: 2,
    loopsCompleted: 1,
    linksUsed: 5,
    bestChainLength: 5,
    energyNodesHit: 2,
    batteriesLit: 3,
    batteriesRequired: 3,
    loopClosed: true,
    loopHoldMs: 4200,
    primaryGoalComplete: true,
    stabilized: false,
    collapsed: false,
    failureReason: ''
  },
  stepHash: '04ce9b1a'
};

const results = [];
for (const payload of [replay, pulseReplay]) {
  const response = await scoreSubmit(
    new Request('https://event-horizon.test/.netlify/functions/score-submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
  );
  const body = await response.json();
  const expectedScore = payload.mode === 'pulse-chain' ? payload.result.score : payload.score;
  if (response.status !== 200 || !body.ok || body.score !== expectedScore) {
    console.error(JSON.stringify({ status: response.status, body }, null, 2));
    process.exit(1);
  }
  results.push({ status: response.status, body });
}

console.log(JSON.stringify(results, null, 2));
