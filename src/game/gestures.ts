import { distanceSquared, distanceToSegmentSquared } from './math';

export interface WorldPoint {
  x: number;
  y: number;
}

export interface GesturePoint extends WorldPoint {
  screenX: number;
  screenY: number;
  t: number;
}

export interface SwipeGesture {
  points: GesturePoint[];
  start: GesturePoint;
  end: GesturePoint;
  screenDistance: number;
  worldDistance: number;
  durationMs: number;
}

export interface RecordedGesturePoint extends WorldPoint {
  t: number;
}

export type GesturePathPoint = WorldPoint & { t?: number };

export function screenPathLength(points: readonly GesturePoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    distance += Math.hypot(point.screenX - previous.screenX, point.screenY - previous.screenY);
  }
  return distance;
}

export function worldPathLength(points: readonly WorldPoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    distance += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return distance;
}

export function makeSwipeGesture(points: readonly GesturePoint[]): SwipeGesture {
  const copied = points.map((point) => ({ ...point }));
  const start = copied[0];
  const end = copied[copied.length - 1];
  return {
    points: copied,
    start,
    end,
    screenDistance: screenPathLength(copied),
    worldDistance: worldPathLength(copied),
    durationMs: Math.max(0, end.t - start.t)
  };
}

export function quantizeGesturePath(
  points: readonly GesturePathPoint[],
  maxPoints = 24
): RecordedGesturePoint[] {
  if (points.length === 0) {
    return [];
  }

  const simplified = simplifyWorldPath(points, maxPoints);
  const baseT = simplified[0].t ?? points[0].t ?? 0;
  return simplified.map((point, index) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
    t: Math.max(0, Math.round((point.t ?? baseT + index * 16) - baseT))
  }));
}

export function simplifyWorldPath<T extends WorldPoint>(points: readonly T[], maxPoints = 24): T[] {
  if (points.length <= maxPoints) {
    return points.map((point) => point);
  }

  let toleranceSq = 12 * 12;
  let simplified = rdp(points, toleranceSq);
  while (simplified.length > maxPoints && toleranceSq < 180 * 180) {
    toleranceSq *= 1.65;
    simplified = rdp(points, toleranceSq);
  }

  if (simplified.length <= maxPoints) {
    return simplified;
  }

  const sampled: T[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * (simplified.length - 1));
    sampled.push(simplified[sourceIndex]);
  }
  return sampled;
}

function rdp<T extends WorldPoint>(points: readonly T[], toleranceSq: number): T[] {
  if (points.length <= 2) {
    return points.map((point) => point);
  }

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifyRange(points, keep, 0, points.length - 1, toleranceSq);
  return points.filter((_, index) => keep[index]);
}

function simplifyRange<T extends WorldPoint>(
  points: readonly T[],
  keep: boolean[],
  startIndex: number,
  endIndex: number,
  toleranceSq: number
): void {
  let bestIndex = -1;
  let bestDistance = 0;
  const start = points[startIndex];
  const end = points[endIndex];

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const point = points[index];
    const distance = distanceToSegmentSquared(point.x, point.y, start.x, start.y, end.x, end.y);
    if (distance > bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  if (bestIndex === -1 || bestDistance <= toleranceSq) {
    return;
  }

  keep[bestIndex] = true;
  simplifyRange(points, keep, startIndex, bestIndex, toleranceSq);
  simplifyRange(points, keep, bestIndex, endIndex, toleranceSq);
}

export function segmentToSegmentDistanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) {
    return 0;
  }
  return Math.min(
    distanceToSegmentSquared(ax, ay, cx, cy, dx, dy),
    distanceToSegmentSquared(bx, by, cx, cy, dx, dy),
    distanceToSegmentSquared(cx, cy, ax, ay, bx, by),
    distanceToSegmentSquared(dx, dy, ax, ay, bx, by)
  );
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy);
  const o2 = orientation(ax, ay, bx, by, dx, dy);
  const o3 = orientation(cx, cy, dx, dy, ax, ay);
  const o4 = orientation(cx, cy, dx, dy, bx, by);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  return (
    (o1 === 0 && onSegment(ax, ay, cx, cy, bx, by)) ||
    (o2 === 0 && onSegment(ax, ay, dx, dy, bx, by)) ||
    (o3 === 0 && onSegment(cx, cy, ax, ay, dx, dy)) ||
    (o4 === 0 && onSegment(cx, cy, bx, by, dx, dy))
  );
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): -1 | 0 | 1 {
  const value = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(value) < 0.000001) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function onSegment(ax: number, ay: number, px: number, py: number, bx: number, by: number): boolean {
  return (
    px <= Math.max(ax, bx) &&
    px >= Math.min(ax, bx) &&
    py <= Math.max(ay, by) &&
    py >= Math.min(ay, by) &&
    distanceSquared(px, py, ax, ay) + distanceSquared(px, py, bx, by) >= distanceSquared(ax, ay, bx, by) - 0.01
  );
}
