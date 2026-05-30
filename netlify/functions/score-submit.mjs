const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'content-type': 'application/json'
};

export default async function scoreSubmit(request) {
  if (request.method === 'OPTIONS') {
    return json({ ok: true }, 204);
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const validationError = validateReplay(payload);
  if (validationError) {
    return json({ ok: false, error: validationError }, 422);
  }

  return json({
    ok: true,
    acceptedAt: new Date().toISOString(),
    score: payload.mode === 'pulse-chain' ? payload.result.score : payload.score,
    survivalMs: payload.mode === 'pulse-chain' ? payload.result.survivalMs : payload.survivalMs
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function validateReplay(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'payload_required';
  }
  if (payload.version !== 1) {
    return 'version_required';
  }
  if (payload.mode === 'pulse-chain') {
    if (typeof payload.seed !== 'string' || payload.seed.length < 3) {
      return 'seed_required';
    }
    if (!Number.isFinite(payload.startedAt)) {
      return 'started_at_required';
    }
    if (!Array.isArray(payload.buildInputs) || !Array.isArray(payload.liveInputs)) {
      return 'inputs_required';
    }
    if (!payload.result || !Number.isFinite(payload.result.score) || !Number.isFinite(payload.result.survivalMs)) {
      return 'result_required';
    }
    if (typeof payload.stepHash !== 'string') {
      return 'hash_required';
    }
    return '';
  }
  if (typeof payload.seed !== 'string' || payload.seed.length < 3) {
    return 'seed_required';
  }
  if (!Number.isFinite(payload.startedAt)) {
    return 'started_at_required';
  }
  if (!Number.isFinite(payload.survivalMs) || payload.survivalMs < 0) {
    return 'survival_required';
  }
  if (!Number.isFinite(payload.score) || payload.score < 0) {
    return 'score_required';
  }
  if (!Array.isArray(payload.tapEvents) || !Array.isArray(payload.swipeEvents)) {
    return 'inputs_required';
  }
  return '';
}
