import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { BLACK_HOLE_X, BLACK_HOLE_Y, MAX_ENERGY, WORLD_HEIGHT, WORLD_WIDTH } from '../constants';
import { clamp, formatTime } from '../math';
import { curvedLinkPath, pointOnQuadratic, resamplePath } from './PulseGeometry';
import type { PulseInputViewState } from './PulseInputController';
import type { PulseNode, PulseSnapshot } from './PulseTypes';
import type { WorldPoint } from '../gestures';

const NODE_COLORS = {
  source: 0x67f4ff,
  conduit: 0x9bb6ff,
  energy: 0x4dffbf,
  delay: 0xffd166,
  splitter: 0xd267ff
} as const;

export class PulseRenderer {
  private readonly world = new Container();
  private readonly background = new Graphics();
  private readonly linkLayer = new Graphics();
  private readonly tempLinkLayer = new Graphics();
  private readonly lensLayer = new Graphics();
  private readonly previewLayer = new Graphics();
  private readonly nodeLayer = new Graphics();
  private readonly pulseLayer = new Graphics();
  private readonly blackHole = new Graphics();
  private readonly hud = new Container();
  private readonly scoreText = new Text({
    text: '0',
    style: new TextStyle({ fill: '#f7fbff', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 50, fontWeight: '900' })
  });
  private readonly metaText = new Text({
    text: '',
    style: new TextStyle({ fill: '#9fe7ff', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 24, fontWeight: '800' })
  });
  private readonly hintText = new Text({
    text: '',
    style: new TextStyle({
      align: 'center',
      fill: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 34,
      fontWeight: '900',
      stroke: { color: '#180923', width: 5 }
    })
  });
  private readonly meter = new Graphics();
  private readonly debugText = new Text({
    text: '',
    style: new TextStyle({ fill: '#dff8ff', fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 17, fontWeight: '600' })
  });
  private readonly endText = new Text({
    text: '',
    style: new TextStyle({
      align: 'center',
      fill: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 48,
      fontWeight: '900',
      stroke: { color: '#12051c', width: 6 }
    })
  });

  constructor(private readonly stage: Container) {
    this.stage.addChild(this.world);
    this.world.addChild(
      this.background,
      this.linkLayer,
      this.tempLinkLayer,
      this.blackHole,
      this.lensLayer,
      this.previewLayer,
      this.nodeLayer,
      this.pulseLayer,
      this.hintText,
      this.hud
    );
    this.hud.addChild(this.meter, this.scoreText, this.metaText, this.debugText, this.endText);
    this.hintText.anchor.set(0.5);
    this.hintText.position.set(WORLD_WIDTH / 2, 260);
    this.scoreText.position.set(68, 68);
    this.metaText.position.set(72, 130);
    this.debugText.position.set(72, 178);
    this.endText.anchor.set(0.5);
    this.endText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT * 0.52);
    this.drawBackground();
  }

  render(
    snapshot: PulseSnapshot,
    input: PulseInputViewState,
    options: { scale: number; offsetX: number; offsetY: number; debug: boolean }
  ): void {
    this.world.position.set(options.offsetX, options.offsetY);
    this.world.scale.set(options.scale);
    this.renderLinks(snapshot);
    this.renderBlackHole(snapshot);
    this.renderLenses(snapshot);
    this.renderPreview(snapshot, input);
    this.renderNodes(snapshot, input);
    this.renderPulses(snapshot);
    this.renderHud(snapshot, input, options.debug);
  }

  destroy(): void {
    this.stage.removeChild(this.world);
    this.world.destroy({ children: true });
  }

  private drawBackground(): void {
    this.background.clear();
    this.background.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill(0x03040a);
    for (let index = 0; index < 260; index += 1) {
      const x = (index * 197.63) % WORLD_WIDTH;
      const y = (index * 311.19) % WORLD_HEIGHT;
      const depth = (index % 13) / 12;
      this.background.circle(x, y, 1.1 + depth * 2.3).fill({ color: 0xc8efff, alpha: 0.17 + depth * 0.35 });
    }
    for (let index = 0; index < 170; index += 1) {
      const t = index / 169;
      const angle = t * Math.PI * 8.6;
      const radius = 80 + t * 690;
      const x = BLACK_HOLE_X + Math.cos(angle) * radius;
      const y = BLACK_HOLE_Y + Math.sin(angle) * radius * 0.56;
      this.background.circle(x, y, 3 + t * 6).fill({ color: index % 2 === 0 ? 0x264e9a : 0x743a96, alpha: 0.05 + (1 - t) * 0.08 });
    }
  }

  private renderLinks(snapshot: PulseSnapshot): void {
    this.linkLayer.clear();
    this.tempLinkLayer.clear();
    for (const link of snapshot.links) {
      const from = findNode(snapshot.nodes, link.fromId);
      const to = findNode(snapshot.nodes, link.toId);
      if (!from || !to) {
        continue;
      }
      const layer = link.temporary ? this.tempLinkLayer : this.linkLayer;
      const alpha = link.temporary ? clamp(1 - link.ageMs / link.expiresMs, 0, 1) : 1;
      this.drawCurve(layer, curvedLinkPath(from, to, link.temporary ? -0.16 : 0.12), {
        glowColor: link.temporary ? 0xd267ff : 0x4dccff,
        coreColor: link.temporary ? 0xffffff : 0x9fe7ff,
        alpha,
        width: link.temporary ? 9 : 6
      });
      this.drawFlowDots(layer, from, to, snapshot.timeMs, link.temporary, alpha);
    }
  }

  private renderBlackHole(snapshot: PulseSnapshot): void {
    this.blackHole.clear();
    const pulse = Math.sin(snapshot.timeMs * 0.004) * 0.5 + 0.5;
    const collapse = 1 - snapshot.darkEnergy / MAX_ENERGY;
    const radius = 92 + collapse * 58 + (snapshot.phase === 'ended' && snapshot.collapsed ? 130 : 0);
    this.blackHole.circle(BLACK_HOLE_X, BLACK_HOLE_Y, radius * 2.2).fill({ color: 0x0b1426, alpha: 0.12 + collapse * 0.18 });
    this.blackHole.circle(BLACK_HOLE_X, BLACK_HOLE_Y, radius * 1.28).stroke({
      color: snapshot.phase === 'ended' && snapshot.stabilized ? 0x4dffbf : 0x6bcfff,
      alpha: 0.22 + collapse * 0.28,
      width: 7 + pulse * 6
    });
    this.blackHole.circle(BLACK_HOLE_X, BLACK_HOLE_Y, radius).fill({ color: 0x000000, alpha: 0.86 });
    this.blackHole.circle(BLACK_HOLE_X, BLACK_HOLE_Y, radius * 0.38).fill({ color: 0x03040a, alpha: 1 });
  }

  private renderLenses(snapshot: PulseSnapshot): void {
    this.lensLayer.clear();
    for (const lens of snapshot.lenses) {
      const alpha = clamp(1 - lens.ageMs / lens.durationMs, 0, 1);
      const smooth = resamplePath(lens.path, 44);
      this.drawCurve(this.lensLayer, smooth, {
        glowColor: lens.success ? 0xd267ff : 0xff6a83,
        coreColor: lens.success ? 0xffffff : 0xffb0c0,
        alpha,
        width: 8
      });
      const end = smooth[smooth.length - 1];
      this.lensLayer.circle(end.x, end.y, 15).stroke({ color: lens.success ? 0xffffff : 0xff6a83, alpha, width: 4 });
    }
  }

  private renderPreview(snapshot: PulseSnapshot, input: PulseInputViewState): void {
    this.previewLayer.clear();
    if (snapshot.phase === 'build' && input.previewFromId && input.previewPoint) {
      const from = findNode(snapshot.nodes, input.previewFromId);
      if (from) {
        this.drawCurve(this.previewLayer, curvedLinkPath(from, input.previewPoint, 0.08), {
          glowColor: 0xd267ff,
          coreColor: 0xffffff,
          alpha: 0.58,
          width: 5
        });
      }
    }
    if (snapshot.phase === 'pulse' && input.liveGesture.length > 1) {
      this.drawCurve(this.previewLayer, resamplePath(input.liveGesture, 36), {
        glowColor: 0xd267ff,
        coreColor: 0xffffff,
        alpha: 0.85,
        width: 7
      });
    }
  }

  private renderNodes(snapshot: PulseSnapshot, input: PulseInputViewState): void {
    this.nodeLayer.clear();
    for (const node of snapshot.nodes) {
      const selected = input.selectedNodeId === node.id;
      const nearest = input.nearestNodeId === node.id;
      const active = node.activationMs > 0;
      const color = NODE_COLORS[node.type];
      const halo = selected || nearest || active ? 0.56 : node.type === 'energy' || node.type === 'source' ? 0.34 : 0.22;
      this.nodeLayer.circle(node.x, node.y, node.radius + 26 + (active ? 18 : 0)).fill({ color, alpha: halo * 0.23 });
      this.nodeLayer.circle(node.x, node.y, node.radius + 12).stroke({ color, alpha: halo, width: selected ? 7 : 4 });
      if (node.type === 'splitter') {
        this.nodeLayer.regularPoly(node.x, node.y, node.radius, 3, -Math.PI / 2).fill({ color, alpha: 0.86 });
      } else if (node.type === 'delay') {
        this.nodeLayer.roundRect(node.x - node.radius * 0.74, node.y - node.radius * 0.74, node.radius * 1.48, node.radius * 1.48, 12).fill({ color, alpha: 0.88 });
      } else {
        this.nodeLayer.circle(node.x, node.y, node.radius).fill({ color, alpha: 0.88 });
      }
      this.nodeLayer.circle(node.x, node.y, node.radius * 0.45).fill({ color: 0xffffff, alpha: active ? 0.82 : 0.36 });
    }
  }

  private renderPulses(snapshot: PulseSnapshot): void {
    this.pulseLayer.clear();
    for (const pulse of snapshot.pulses) {
      const point = pulsePoint(snapshot, pulse.currentNodeId, pulse.nextNodeId, pulse.progress);
      if (!point) {
        continue;
      }
      this.pulseLayer.circle(point.x, point.y, 30).fill({ color: 0x67f4ff, alpha: 0.18 });
      this.pulseLayer.circle(point.x, point.y, 15).fill({ color: 0xd267ff, alpha: 0.72 });
      this.pulseLayer.circle(point.x, point.y, 7).fill({ color: 0xffffff, alpha: 0.95 });
    }
  }

  private renderHud(snapshot: PulseSnapshot, input: PulseInputViewState, debug: boolean): void {
    this.scoreText.text = String(snapshot.score);
    this.metaText.text = `x${snapshot.multiplier}  LINKS ${snapshot.linksUsed}/${snapshot.linkBudget}  LENS ${snapshot.lensCharges}/2  BEST ${Math.max(snapshot.score, Number(localStorage.getItem('eventHorizon.bestScore') ?? 0))}`;
    this.hintText.text = snapshot.tutorialHint;
    this.hintText.visible = snapshot.phase !== 'ended';
    this.meter.clear();
    const meterWidth = WORLD_WIDTH - 156;
    const fill = meterWidth * clamp(snapshot.darkEnergy / MAX_ENERGY, 0, 1);
    this.meter.roundRect(78, WORLD_HEIGHT - 136, meterWidth, 40, 8).fill({ color: 0x061120, alpha: 0.9 });
    this.meter.roundRect(78, WORLD_HEIGHT - 136, meterWidth, 40, 8).stroke({ color: 0x78f2ff, alpha: 0.35, width: 2 });
    this.meter.roundRect(86, WORLD_HEIGHT - 126, fill, 20, 6).fill({ color: snapshot.darkEnergy < 25 ? 0xff5d73 : 0x67f4ff, alpha: 0.96 });
    this.meter.roundRect(86, WORLD_HEIGHT - 172, 220, 28, 4).fill({ color: 0x03040a, alpha: 0.46 });
    this.meter.roundRect(0, 0, 0, 0, 0);
    this.endText.visible = snapshot.phase === 'ended';
    this.endText.text = snapshot.phase === 'ended'
      ? `${snapshot.stabilized ? 'SECTOR STABILIZED' : 'GALAXY COLLAPSED'}\n${snapshot.score}  •  ${formatTime(snapshot.timeMs)}\nSEED ${snapshot.seed}`
      : '';
    this.debugText.visible = debug;
    if (debug) {
      this.debugText.text = [
        `phase: ${snapshot.phase}`,
        `selected: ${input.selectedNodeId ?? '--'} nearest: ${input.nearestNodeId ?? '--'}`,
        `links: ${snapshot.linksUsed}/${snapshot.linkBudget} pulses: ${snapshot.pulses.length}`,
        `last: ${snapshot.lastInputResult.message}`,
        `hash: ${snapshot.stepHash}`
      ].join('\n');
    }
  }

  private drawCurve(
    graphics: Graphics,
    points: readonly WorldPoint[],
    options: { glowColor: number; coreColor: number; alpha: number; width: number }
  ): void {
    if (points.length < 2) {
      return;
    }
    drawSmooth(graphics, points);
    graphics.stroke({ color: options.glowColor, alpha: options.alpha * 0.28, width: options.width * 3.4 });
    drawSmooth(graphics, points);
    graphics.stroke({ color: options.coreColor, alpha: options.alpha, width: options.width });
  }

  private drawFlowDots(
    graphics: Graphics,
    from: PulseNode,
    to: PulseNode,
    timeMs: number,
    temporary: boolean,
    alpha: number
  ): void {
    const path = curvedLinkPath(from, to, temporary ? -0.16 : 0.12);
    for (let index = 0; index < 3; index += 1) {
      const t = ((timeMs * 0.00018 + index / 3) % 1 + 1) % 1;
      const point = pointOnQuadratic(path[0], path[1], path[2], t);
      graphics.circle(point.x, point.y, temporary ? 6 : 4).fill({ color: temporary ? 0xffffff : 0x9fe7ff, alpha: alpha * 0.66 });
    }
  }
}

function drawSmooth(graphics: Graphics, points: readonly WorldPoint[]): void {
  graphics.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    graphics.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  graphics.lineTo(last.x, last.y);
}

function findNode(nodes: readonly PulseNode[], id: number): PulseNode | undefined {
  return nodes.find((node) => node.id === id);
}

function pulsePoint(snapshot: PulseSnapshot, fromId: number, toId: number | undefined, progress: number): WorldPoint | undefined {
  const from = findNode(snapshot.nodes, fromId);
  if (!from) {
    return undefined;
  }
  if (toId === undefined) {
    return from;
  }
  const to = findNode(snapshot.nodes, toId);
  if (!to) {
    return from;
  }
  const path = curvedLinkPath(from, to, 0.12);
  return pointOnQuadratic(path[0], path[1], path[2], progress);
}
