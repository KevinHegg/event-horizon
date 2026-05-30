export const WORLD_WIDTH = 1080;
export const WORLD_HEIGHT = 1920;
export const FIXED_STEP_MS = 1000 / 60;
export const INITIAL_ENERGY = 78;
export const MAX_ENERGY = 100;
export const ORB_POOL_SIZE = 24;
export const FLYBY_POOL_SIZE = 6;
export const BLACK_HOLE_X = WORLD_WIDTH / 2;
export const BLACK_HOLE_Y = WORLD_HEIGHT * 0.44;
export const SCORE_ENDPOINT =
  import.meta.env.VITE_SCORE_ENDPOINT ?? '/.netlify/functions/score-submit';
