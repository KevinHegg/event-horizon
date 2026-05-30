import { clamp, distanceSquared, distanceToSegmentSquared } from '../math';
import type { PulseNode } from './PulseTypes';
import type { WorldPoint } from '../gestures';

export function simplifyPath<T extends WorldPoint>(points: readonly T[], maxPoints = 24): T[] {
  if (points.length <= maxPoints) {
    return points.map((point) => point);
  }
  const sampled: T[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(points[Math.round((index / (maxPoints - 1)) * (points.length - 1))]);
  }
  return sampled;
}

export function resamplePath(points: readonly WorldPoint[], spacing = 38): WorldPoint[] {
  if (points.length <= 1) {
    return points.map((point) => ({ ...point }));
  }
  const result: WorldPoint[] = [{ ...points[0] }];
  let carry = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const segmentLength = Math.max(0.001, Math.hypot(point.x - previous.x, point.y - previous.y));
    let distance = spacing - carry;
    while (distance <= segmentLength) {
      const t = distance / segmentLength;
      result.push({
        x: previous.x + (point.x - previous.x) * t,
        y: previous.y + (point.y - previous.y) * t
      });
      distance += spacing;
    }
    carry = segmentLength - (distance - spacing);
  }
  const last = points[points.length - 1];
  result.push({ ...last });
  return result;
}

export function smoothPathQuadratic(points: readonly WorldPoint[]): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const midpoint = midpointOf(point, next);
    commands.push(`Q ${point.x} ${point.y} ${midpoint.x} ${midpoint.y}`);
  }
  const last = points[points.length - 1];
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(' ');
}

export function distancePointToSegment(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  return Math.sqrt(distanceToSegmentSquared(point.x, point.y, start.x, start.y, end.x, end.y));
}

export function distanceSegmentToSegment(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): number {
  if (segmentsIntersect(a, b, c, d)) {
    return 0;
  }
  return Math.sqrt(
    Math.min(
      distanceToSegmentSquared(a.x, a.y, c.x, c.y, d.x, d.y),
      distanceToSegmentSquared(b.x, b.y, c.x, c.y, d.x, d.y),
      distanceToSegmentSquared(c.x, c.y, a.x, a.y, b.x, b.y),
      distanceToSegmentSquared(d.x, d.y, a.x, a.y, b.x, b.y)
    )
  );
}

export function nearestNodeToPath(
  nodes: readonly PulseNode[],
  path: readonly WorldPoint[],
  radius = 118,
  excludedId?: number
): PulseNode | undefined {
  let best: PulseNode | undefined;
  let bestDistance = radius;
  for (const node of nodes) {
    if (node.id === excludedId) {
      continue;
    }
    const distance = distanceNodeToPath(node, path);
    if (distance <= bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

export function nearestTwoNodesToPath(
  nodes: readonly PulseNode[],
  path: readonly WorldPoint[],
  radius = 126
): [PulseNode, PulseNode] | undefined {
  const ranked = nodes
    .map((node) => ({ node, distance: distanceNodeToPath(node, path) }))
    .filter((entry) => entry.distance <= radius)
    .sort((a, b) => a.distance - b.distance);
  if (ranked.length < 2) {
    return undefined;
  }
  return [ranked[0].node, ranked[1].node];
}

export function pathCrossesNodeRadius(path: readonly WorldPoint[], node: PulseNode, radius = node.radius + 44): boolean {
  return distanceNodeToPath(node, path) <= radius;
}

export function nodesCrossedByPath(
  nodes: readonly PulseNode[],
  path: readonly WorldPoint[],
  radius = 76
): PulseNode[] {
  const crossed = nodes
    .map((node) => {
      const hit = firstPathHit(node, path, radius + node.radius * 0.35);
      return hit === undefined ? undefined : { node, order: hit };
    })
    .filter((entry): entry is { node: PulseNode; order: number } => entry !== undefined)
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.node);
  const result: PulseNode[] = [];
  for (const node of crossed) {
    if (result[result.length - 1]?.id !== node.id) {
      result.push(node);
    }
  }
  return result;
}

export function distanceNodeToPath(node: PulseNode, path: readonly WorldPoint[]): number {
  if (path.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (path.length === 1) {
    return Math.sqrt(distanceSquared(node.x, node.y, path[0].x, path[0].y));
  }
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const point = path[index];
    best = Math.min(best, distancePointToSegment(node, previous, point));
  }
  return best;
}

function firstPathHit(node: PulseNode, path: readonly WorldPoint[], radius: number): number | undefined {
  if (path.length === 0) {
    return undefined;
  }
  let traveled = 0;
  if (path.length === 1) {
    return Math.sqrt(distanceSquared(node.x, node.y, path[0].x, path[0].y)) <= radius ? 0 : undefined;
  }
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const point = path[index];
    const segmentLength = Math.max(0.001, Math.hypot(point.x - previous.x, point.y - previous.y));
    const distance = distancePointToSegment(node, previous, point);
    if (distance <= radius) {
      return traveled + segmentLength * projectionT(node, previous, point);
    }
    traveled += segmentLength;
  }
  return undefined;
}

function projectionT(point: WorldPoint, start: WorldPoint, end: WorldPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) {
    return 0;
  }
  return clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq, 0, 1);
}

export function curvedLinkPath(from: WorldPoint, to: WorldPoint, bend = 0.12): WorldPoint[] {
  const mid = midpointOf(from, to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const blackHolePull = 0.18;
  const control = {
    x: mid.x - (dy / length) * length * bend + (540 - mid.x) * blackHolePull,
    y: mid.y + (dx / length) * length * bend + (845 - mid.y) * blackHolePull
  };
  return [from, control, to];
}

export function pointOnQuadratic(a: WorldPoint, b: WorldPoint, c: WorldPoint, t: number): WorldPoint {
  const clamped = clamp(t, 0, 1);
  const inv = 1 - clamped;
  return {
    x: inv * inv * a.x + 2 * inv * clamped * b.x + clamped * clamped * c.x,
    y: inv * inv * a.y + 2 * inv * clamped * b.y + clamped * clamped * c.y
  };
}

function midpointOf(a: WorldPoint, b: WorldPoint): WorldPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function segmentsIntersect(a: WorldPoint, b: WorldPoint, c: WorldPoint, d: WorldPoint): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  return false;
}

function orientation(a: WorldPoint, b: WorldPoint, c: WorldPoint): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.000001) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}
