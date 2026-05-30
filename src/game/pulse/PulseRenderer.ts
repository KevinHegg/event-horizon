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
  private readonly nodeTextLayer = new Container();
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
  private readonly messageText = new Text({
    text: '',
    style: new TextStyle({
      align: 'center',
      fill: '#9ffcff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 26,
      fontWeight: '900',
      stroke: { color: '#061120', width: 4 }
    })
  });
  private readonly strategyText = new Text({
    text: '',
    style: new TextStyle({
      fill: '#f7fbff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 18,
      fontWeight: '800',
      lineHeight: 23,
      stroke: { color: '#061120', width: 4 }
    })
  });
  private readonly goalText = new Text({
    text: '',
    style: new TextStyle({
      fill: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 25,
      fontWeight: '900',
      lineHeight: 31,
      stroke: { color: '#061120', width: 5 }
    })
  });
  private readonly meter = new Graphics();
  private readonly infoCard = new Graphics();
  private readonly infoTitleText = new Text({
    text: '',
    style: new TextStyle({
      fill: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 27,
      fontWeight: '900',
      stroke: { color: '#061120', width: 4 }
    })
  });
  private readonly infoBodyText = new Text({
    text: '',
    style: new TextStyle({
      fill: '#dff8ff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 20,
      fontWeight: '700',
      lineHeight: 26,
      wordWrap: true,
      wordWrapWidth: 780
    })
  });
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
      fontSize: 34,
      fontWeight: '900',
      lineHeight: 43,
      wordWrap: true,
      wordWrapWidth: 860,
      stroke: { color: '#12051c', width: 6 }
    })
  });
  private readonly nodeTexts = new Map<number, Text>();

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
      this.nodeTextLayer,
      this.pulseLayer,
      this.hintText,
      this.hud
    );
    this.hud.addChild(
      this.meter,
      this.scoreText,
      this.metaText,
      this.goalText,
      this.strategyText,
      this.infoCard,
      this.infoTitleText,
      this.infoBodyText,
      this.messageText,
      this.debugText,
      this.endText
    );
    this.hintText.anchor.set(0.5);
    this.hintText.position.set(WORLD_WIDTH / 2, 260);
    this.messageText.anchor.set(0.5);
    this.messageText.position.set(WORLD_WIDTH / 2, 318);
    this.scoreText.position.set(68, 68);
    this.metaText.position.set(72, 130);
    this.goalText.position.set(68, 178);
    this.strategyText.position.set(68, 385);
    this.infoTitleText.position.set(96, WORLD_HEIGHT - 360);
    this.infoBodyText.position.set(96, WORLD_HEIGHT - 320);
    this.debugText.position.set(72, 520);
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
      const flash = clamp(link.flashMs / 520, 0, 1);
      const loopReady = !link.temporary && snapshot.chainAnalysis.sourceLoopClosed;
      const routerPreferred = !link.temporary && isRouterPreferredLink(snapshot, link);
      this.drawCurve(layer, curvedLinkPath(from, to, link.temporary ? -0.16 : 0.12), {
        glowColor: link.temporary ? 0xd267ff : loopReady ? 0x4dffbf : routerPreferred ? 0xffd166 : 0x4dccff,
        coreColor: link.temporary ? 0xffffff : routerPreferred ? 0xffffff : 0x9fe7ff,
        alpha,
        width: link.temporary ? 9 + flash * 5 : (loopReady || routerPreferred ? 8 : 6) + flash * 4
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
    if (snapshot.tutorialGhostPath.length > 1) {
      this.drawCurve(this.previewLayer, resamplePath(snapshot.tutorialGhostPath, 34), {
        glowColor: 0xd267ff,
        coreColor: 0xffffff,
        alpha: 0.62 + Math.sin(snapshot.timeMs * 0.006) * 0.18,
        width: 6
      });
      const ghost = pointAlongPolyline(snapshot.tutorialGhostPath, (snapshot.timeMs * 0.00032) % 1);
      this.previewLayer.circle(ghost.x, ghost.y, 18).fill({ color: 0xffffff, alpha: 0.74 });
      this.previewLayer.circle(ghost.x, ghost.y, 34).stroke({ color: 0xd267ff, alpha: 0.48, width: 5 });
    }
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
    if (snapshot.phase === 'build' && input.liveGesture.length > 1) {
      this.drawCurve(this.previewLayer, resamplePath(input.liveGesture, 36), {
        glowColor: 0xd267ff,
        coreColor: 0xffffff,
        alpha: 0.82,
        width: 7
      });
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
    const visibleNodeIds = new Set<number>();
    for (const node of snapshot.nodes) {
      const selected = input.selectedNodeId === node.id;
      const nearest = input.nearestNodeId === node.id;
      const active = node.activationMs > 0;
      const highlighted =
        snapshot.tutorialHighlightNodeIds.includes(node.id) ||
        snapshot.deadEndNodeId === node.id ||
        snapshot.suggestedFixes.some((fix) => fix.fromId === node.id || fix.toId === node.id);
      const color = NODE_COLORS[node.type];
      const earlyTutorial =
        snapshot.tutorialActive &&
        ['battery-goal', 'swipe-batteries', 'add-battery', 'close-loop', 'press-play', 'loop-alive'].includes(snapshot.tutorialStep);
      const dimmedForTutorial = earlyTutorial && node.type !== 'source' && node.type !== 'energy' && node.type !== 'conduit';
      const alphaBase = dimmedForTutorial ? 0.18 : 1;
      const halo = selected || nearest || active || highlighted ? 0.72 : node.type === 'energy' || node.type === 'source' ? 0.42 : 0.24;
      if (node.type === 'energy' && !node.lit) {
        const pulse = 0.42 + Math.sin(snapshot.timeMs * 0.006 + node.id) * 0.18;
        this.nodeLayer.circle(node.x, node.y, node.radius + 42).stroke({ color: 0xffffff, alpha: pulse * alphaBase, width: 5 });
      }
      if (node.type === 'energy' && node.lit) {
        this.nodeLayer.circle(node.x, node.y, node.radius + 48).fill({ color: 0x4dffbf, alpha: 0.18 });
        this.nodeLayer.circle(node.x, node.y, node.radius + 24).stroke({ color: 0xffffff, alpha: 0.84, width: 7 });
      }
      this.nodeLayer.circle(node.x, node.y, node.radius + 30 + (active || highlighted ? 20 : 0)).fill({ color, alpha: halo * 0.23 * alphaBase });
      if (node.primed) {
        this.nodeLayer.circle(node.x, node.y, node.radius + 26).stroke({ color: 0xffffff, alpha: 0.84, width: 6 });
      }
      if (node.stabilizedMs > 0) {
        this.nodeLayer.circle(node.x, node.y, node.radius + 38).stroke({ color: 0x4dffbf, alpha: 0.76, width: 8 });
      }
      this.nodeLayer.circle(node.x, node.y, node.radius + 12).stroke({
        color: highlighted ? 0xffffff : color,
        alpha: halo * alphaBase,
        width: selected || highlighted ? 7 : 4
      });
      if (node.type === 'source') {
        this.nodeLayer.circle(node.x, node.y, node.radius).fill({ color, alpha: 0.9 * alphaBase });
        this.nodeLayer.regularPoly(node.x + 4, node.y, node.radius * 0.45, 3, Math.PI / 2).fill({ color: 0x061120, alpha: 0.72 * alphaBase });
      } else if (node.type === 'energy') {
        this.nodeLayer.regularPoly(node.x, node.y, node.radius, 5, -Math.PI / 2).fill({ color, alpha: (node.lit ? 0.98 : 0.82) * alphaBase });
        this.nodeLayer.circle(node.x, node.y, node.radius * 0.62).fill({ color: node.lit ? 0xffffff : 0x061120, alpha: node.lit ? 0.34 : 0.18 });
      } else if (node.type === 'splitter') {
        this.nodeLayer.regularPoly(node.x, node.y, node.radius, 3, -Math.PI / 2 + node.splitterPriority * 0.7).fill({ color, alpha: 0.86 * alphaBase });
        this.nodeLayer.circle(node.x, node.y, node.radius + 26).stroke({ color: 0xffd166, alpha: 0.3 * alphaBase, width: 4 });
      } else if (node.type === 'delay') {
        this.nodeLayer.roundRect(node.x - node.radius * 0.74, node.y - node.radius * 0.74, node.radius * 1.48, node.radius * 1.48, 12).fill({ color, alpha: 0.88 * alphaBase });
        for (let tick = 0; tick <= node.delayLevel; tick += 1) {
          this.nodeLayer.roundRect(node.x - 22 + tick * 22, node.y + node.radius + 16, 13, 7, 3).fill({ color: 0xffffff, alpha: 0.78 * alphaBase });
        }
      } else {
        this.nodeLayer.circle(node.x, node.y, node.radius).stroke({ color, alpha: 0.9 * alphaBase, width: 8 });
        this.nodeLayer.circle(node.x, node.y, node.radius * 0.42).fill({ color, alpha: 0.72 * alphaBase });
      }
      this.nodeLayer.circle(node.x, node.y, node.radius * 0.24).fill({ color: 0xffffff, alpha: (active ? 0.82 : 0.26) * alphaBase });
      const text = this.nodeText(node.id);
      text.text = iconForNode(node);
      text.position.set(node.x, node.y - 2);
      text.visible = true;
      visibleNodeIds.add(node.id);
      if ((snapshot.tutorialActive && highlighted) || (node.type === 'energy' && (node.required || node.lit))) {
        const label = this.nodeText(node.id + 1000);
        label.text = node.type === 'energy' ? (node.lit ? 'BATTERY LIT' : 'BATTERY') : node.label;
        label.position.set(node.x, node.y + node.radius + 46);
        label.visible = true;
        visibleNodeIds.add(node.id + 1000);
      }
    }
    for (const [id, text] of this.nodeTexts) {
      if (!visibleNodeIds.has(id)) {
        text.visible = false;
      }
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
    this.scoreText.text = `Score ${snapshot.score}`;
    this.metaText.text = `x${snapshot.multiplier}  LINKS ${snapshot.linksUsed}/${snapshot.linkBudget}  LENS ${snapshot.lensCharges}/2  BEST ${Math.max(snapshot.score, Number(localStorage.getItem('eventHorizon.bestScore') ?? 0))}`;
    this.goalText.visible = snapshot.phase !== 'ended';
    this.goalText.text =
      snapshot.phase === 'build'
        ? [
            'GOAL',
            `Light ${snapshot.batteriesLit}/${snapshot.batteriesRequired} Batteries`,
            `Loop: ${snapshot.chainAnalysis.sourceLoopClosed ? 'Yes' : 'No'}`,
            'Press Play'
          ].join('\n')
        : [
            'GOAL',
            `Batteries lit: ${snapshot.batteriesLit}/${snapshot.batteriesRequired}`,
            `Loop: ${snapshot.loopClosed ? 'active' : 'broken'}`,
            `Collapse: ${snapshot.darkEnergy < 25 ? 'danger' : 'stable'}`
          ].join('\n');
    this.strategyText.visible = snapshot.phase === 'build';
    this.strategyText.text = [
      'CHAIN STATUS',
      `Batteries reachable ${snapshot.chainAnalysis.reachableBatteryNodes}/${snapshot.chainAnalysis.totalRequiredBatteries}`,
      `Dead ends ${snapshot.chainAnalysis.deadEndNodeIds.length}`,
      `Loop ${snapshot.chainAnalysis.sourceLoopClosed ? 'Yes' : 'No'}`,
      snapshot.chainAnalysis.hint,
      snapshot.chainAnalysis.sourceLoopClosed ? 'LOOP READY' : 'CONNECT BACK TO SOURCE'
    ].join('\n');
    this.hintText.text = snapshot.tutorialHint;
    this.hintText.visible = snapshot.phase !== 'ended';
    this.messageText.text = snapshot.lastInputResult.message;
    this.messageText.visible = snapshot.phase !== 'ended' && snapshot.lastInputResult.message !== snapshot.tutorialHint;
    this.meter.clear();
    const meterWidth = WORLD_WIDTH - 156;
    const fill = meterWidth * clamp(snapshot.darkEnergy / MAX_ENERGY, 0, 1);
    this.meter.roundRect(78, WORLD_HEIGHT - 178, 270, 30, 4).fill({ color: 0x03040a, alpha: 0.54 });
    this.meter.roundRect(78, WORLD_HEIGHT - 136, meterWidth, 40, 8).fill({ color: 0x061120, alpha: 0.9 });
    this.meter.roundRect(78, WORLD_HEIGHT - 136, meterWidth, 40, 8).stroke({ color: 0x78f2ff, alpha: 0.35, width: 2 });
    this.meter.roundRect(86, WORLD_HEIGHT - 126, fill, 20, 6).fill({ color: snapshot.darkEnergy < 25 ? 0xff5d73 : 0x67f4ff, alpha: 0.96 });
    this.renderInfoCard(snapshot);
    this.endText.visible = snapshot.phase === 'ended';
    if (snapshot.phase === 'ended') {
      const fix = snapshot.suggestedFixes[0];
      this.endText.text = snapshot.stabilized
        ? `SECTOR STABILIZED\nBatteries lit: ${snapshot.batteriesLit}/${snapshot.batteriesRequired}\nLoop held: ${formatTime(snapshot.loopHoldMs)}\nSEED ${snapshot.seed}`
        : `${snapshot.endReason === 'pulse-died' ? 'PULSE LOST' : 'GALAXY COLLAPSED'}\nBatteries lit: ${snapshot.batteriesLit}/${snapshot.batteriesRequired}\nProblem: ${shortFailure(snapshot.failureReason)}\n${fix ? fix.message : 'Fix: close the loop.'}`;
    } else {
      this.endText.text = '';
    }
    this.debugText.visible = debug;
    if (debug) {
      this.debugText.text = [
        `phase: ${snapshot.phase}`,
        `tutorial: ${snapshot.tutorialStep}`,
        `selected: ${input.selectedNodeId ?? '--'} nearest: ${input.nearestNodeId ?? '--'}`,
        `links: ${snapshot.linksUsed}/${snapshot.linkBudget} pulses: ${snapshot.pulses.length}`,
        `chain: ${snapshot.lastChainNodeIds.join('>') || '--'}`,
        `analysis: ${snapshot.chainAnalysis.hint}`,
        `batteries: ${snapshot.batteriesLit}/${snapshot.batteriesRequired} loop: ${snapshot.loopClosed ? 'yes' : 'no'}`,
        `last: ${snapshot.lastInputResult.message}`,
        `hash: ${snapshot.stepHash}`
      ].join('\n');
    }
  }

  private renderInfoCard(snapshot: PulseSnapshot): void {
    this.infoCard.clear();
    const card = snapshot.nodeInfoCard;
    const visible = snapshot.phase === 'build' && card !== undefined;
    this.infoTitleText.visible = visible;
    this.infoBodyText.visible = visible;
    if (!visible || !card) {
      this.infoTitleText.text = '';
      this.infoBodyText.text = '';
      return;
    }
    this.infoCard.roundRect(72, WORLD_HEIGHT - 382, WORLD_WIDTH - 144, 154, 8).fill({ color: 0x061120, alpha: 0.9 });
    this.infoCard.roundRect(72, WORLD_HEIGHT - 382, WORLD_WIDTH - 144, 154, 8).stroke({ color: 0x78f2ff, alpha: 0.34, width: 2 });
    this.infoTitleText.text = card.title;
    this.infoBodyText.text = `${card.body}\n${card.action}`;
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

  private nodeText(id: number): Text {
    let text = this.nodeTexts.get(id);
    if (!text) {
      text = new Text({
        text: '',
        style: new TextStyle({
          align: 'center',
          fill: '#061120',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: id >= 1000 ? 18 : 26,
          fontWeight: '900',
          stroke: { color: '#ffffff', width: id >= 1000 ? 2 : 3 }
        })
      });
      text.anchor.set(0.5);
      this.nodeTextLayer.addChild(text);
      this.nodeTexts.set(id, text);
    }
    return text;
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

function iconForNode(node: PulseNode): string {
  if (node.type === 'source') {
    return '▶';
  }
  if (node.type === 'energy') {
    return '★';
  }
  if (node.type === 'delay') {
    return 'II';
  }
  if (node.type === 'splitter') {
    return 'Y';
  }
  return '•';
}

function pointAlongPolyline(points: readonly WorldPoint[], t: number): WorldPoint {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  if (points.length === 1) {
    return points[0];
  }
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    lengths.push(length);
    total += length;
  }
  let target = clamp(t, 0, 1) * total;
  for (let index = 1; index < points.length; index += 1) {
    const length = lengths[index - 1];
    if (target <= length) {
      const local = length <= 0 ? 0 : target / length;
      return {
        x: points[index - 1].x + (points[index].x - points[index - 1].x) * local,
        y: points[index - 1].y + (points[index].y - points[index - 1].y) * local
      };
    }
    target -= length;
  }
  return points[points.length - 1];
}

function isRouterPreferredLink(snapshot: PulseSnapshot, link: { fromId: number; toId: number; temporary: boolean }): boolean {
  if (link.temporary) {
    return false;
  }
  const node = findNode(snapshot.nodes, link.fromId);
  if (!node || node.type !== 'splitter') {
    return false;
  }
  const outgoing = snapshot.links
    .filter((candidate) => !candidate.temporary && candidate.fromId === node.id)
    .sort((a, b) => ((a.toId + node.splitterPriority * 7) % 13) - ((b.toId + node.splitterPriority * 7) % 13));
  return outgoing[0]?.toId === link.toId;
}

function shortFailure(reason: string): string {
  if (reason.includes('Batteries')) {
    return 'Not enough Batteries were lit';
  }
  if (reason.includes('return to Source')) {
    return 'Loop broken';
  }
  if (reason.includes('dead end') || reason.includes('ended at')) {
    return 'Pulse hit a dead end';
  }
  return reason || 'Collapse Meter emptied';
}
