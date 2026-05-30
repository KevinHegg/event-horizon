import { SCORE_ENDPOINT } from './constants';
import type { PulseReplayPayload } from './pulse/PulseTypes';
import type { ReplayPayload } from './types';

export interface ScoreSubmitResult {
  ok: boolean;
  status: number;
  endpoint: string;
}

export async function submitScore(
  payload: ReplayPayload | PulseReplayPayload,
  endpoint = SCORE_ENDPOINT
): Promise<ScoreSubmitResult> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload),
      keepalive: true
    });
    return {
      ok: response.ok,
      status: response.status,
      endpoint
    };
  } catch {
    return {
      ok: false,
      status: 0,
      endpoint
    };
  }
}
