import { BLACK_HOLE_X, BLACK_HOLE_Y, WORLD_HEIGHT, WORLD_WIDTH } from '../constants';
import { createSeededRandom } from '../rng';
import type { PulseLevel, PulseNode, PulseNodeType } from './PulseTypes';

export function getDailyPulseSeed(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `daily-${year}-${month}-${day}`;
}

export function generatePulseLevel(seed: string): PulseLevel {
  const rng = createSeededRandom(`pulse-chain-${seed}`);
  const firstSeed = seed === 'daily-2026-05-30' || seed === 'tutorial' || seed === 'eh-pulse-alpha';
  const baseNodes = firstSeed ? tutorialNodes() : generatedNodes(rng);
  return {
    seed,
    nodes: baseNodes,
    sourceId: 1,
    linkBudget: 6,
    targetScore: 1800,
    targetSurvivalMs: 45000
  };
}

function tutorialNodes(): PulseNode[] {
  const specs: Array<[PulseNodeType, number, number, number, string]> = [
    ['source', 255, 1388, 0, 'SOURCE'],
    ['energy', 420, 1165, 1, 'ENERGY'],
    ['delay', 640, 1015, 1, 'DELAY'],
    ['splitter', 780, 760, 2, 'SPLIT'],
    ['energy', 525, 610, 2, 'ENERGY'],
    ['energy', 835, 1215, 2, 'ENERGY'],
    ['conduit', 310, 810, 2, 'CONDUIT'],
    ['conduit', 700, 1410, 2, 'CONDUIT'],
    ['delay', 250, 1080, 1, 'DELAY'],
    ['splitter', 910, 935, 2, 'SPLIT'],
    ['energy', 485, 1515, 2, 'ENERGY'],
    ['conduit', 805, 545, 2, 'CONDUIT']
  ];
  return specs.map(([type, x, y, ring, label], index) => makeNode(index + 1, type, x, y, ring, label));
}

function generatedNodes(rng: () => number): PulseNode[] {
  const nodeTypes: PulseNodeType[] = [
    'source',
    'energy',
    'delay',
    'splitter',
    'energy',
    'conduit',
    'conduit',
    'energy',
    'conduit',
    'delay',
    'splitter',
    'energy',
    'conduit'
  ];

  const nodes: PulseNode[] = [];
  for (let index = 0; index < nodeTypes.length; index += 1) {
    const type = nodeTypes[index];
    if (type === 'source') {
      nodes.push(makeNode(1, 'source', 230 + rng() * 130, 1320 + rng() * 190, 0, 'SOURCE'));
      continue;
    }
    const ring = index < 6 ? 1 : 2;
    const angle = -2.55 + index * 0.53 + (rng() - 0.5) * 0.22;
    const radiusX = ring === 1 ? 280 + rng() * 48 : 420 + rng() * 78;
    const radiusY = ring === 1 ? 410 + rng() * 46 : 570 + rng() * 84;
    const x = clampToPlayfield(BLACK_HOLE_X + Math.cos(angle) * radiusX);
    const y = clampToPlayfieldY(BLACK_HOLE_Y + Math.sin(angle) * radiusY + 120);
    nodes.push(makeNode(index + 1, type, x, y, ring, labelFor(type)));
  }
  return separateNodes(nodes);
}

function separateNodes(nodes: PulseNode[]): PulseNode[] {
  for (let pass = 0; pass < 5; pass += 1) {
    for (let a = 0; a < nodes.length; a += 1) {
      for (let b = a + 1; b < nodes.length; b += 1) {
        const left = nodes[a];
        const right = nodes[b];
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        if (distance >= 132) {
          continue;
        }
        const push = (132 - distance) / 2;
        left.x = clampToPlayfield(left.x - (dx / distance) * push);
        left.y = clampToPlayfieldY(left.y - (dy / distance) * push);
        right.x = clampToPlayfield(right.x + (dx / distance) * push);
        right.y = clampToPlayfieldY(right.y + (dy / distance) * push);
      }
    }
  }
  return nodes;
}

function makeNode(id: number, type: PulseNodeType, x: number, y: number, ring: number, label: string): PulseNode {
  return {
    id,
    type,
    x,
    y,
    ring,
    label,
    radius: type === 'source' ? 54 : type === 'splitter' ? 50 : 46,
    activationMs: 0,
    scoreCooldownMs: 0
  };
}

function labelFor(type: PulseNodeType): string {
  if (type === 'energy') {
    return 'ENERGY';
  }
  if (type === 'delay') {
    return 'DELAY';
  }
  if (type === 'splitter') {
    return 'SPLIT';
  }
  return 'CONDUIT';
}

function clampToPlayfield(x: number): number {
  return Math.max(126, Math.min(WORLD_WIDTH - 126, x));
}

function clampToPlayfieldY(y: number): number {
  return Math.max(260, Math.min(WORLD_HEIGHT - 330, y));
}
