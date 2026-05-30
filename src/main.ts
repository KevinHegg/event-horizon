import './styles.css';
import { EventHorizonGame } from './game/EventHorizonGame';
import { PulseMode } from './game/pulse/PulseMode';

interface EventHorizonRuntime {
  start: () => Promise<void>;
  restart: () => void;
  setPaused: (paused: boolean) => void;
  setInputDebug: (enabled: boolean) => void;
  exportPoster: () => Promise<string>;
  forceEnd: () => void;
  getSnapshot: () => unknown;
  getReplayPayload: () => unknown;
  destroy?: () => void;
}

const root = document.querySelector<HTMLDivElement>('#game-root');
const restartButton = document.querySelector<HTMLButtonElement>('#restart-button');
const shareButton = document.querySelector<HTMLButtonElement>('#share-button');
const helpButton = document.querySelector<HTMLButtonElement>('#help-button');
const legendButton = document.querySelector<HTMLButtonElement>('#legend-button');
const helpOverlay = document.querySelector<HTMLElement>('#help-overlay');
const helpPlayButton = document.querySelector<HTMLButtonElement>('#help-play-button');
const helpSkipButton = document.querySelector<HTMLButtonElement>('#help-skip-button');
const legendOverlay = document.querySelector<HTMLElement>('#legend-overlay');
const legendCloseButton = document.querySelector<HTMLButtonElement>('#legend-close-button');
const posterLink = document.querySelector<HTMLAnchorElement>('#poster-link');
const pulseControls = document.querySelector<HTMLElement>('#pulse-controls');
const pulseUndoButton = document.querySelector<HTMLButtonElement>('#pulse-undo-button');
const pulseClearButton = document.querySelector<HTMLButtonElement>('#pulse-clear-button');
const pulsePlayButton = document.querySelector<HTMLButtonElement>('#pulse-play-button');

if (
  !root ||
  !restartButton ||
  !shareButton ||
  !helpButton ||
  !legendButton ||
  !helpOverlay ||
  !helpPlayButton ||
  !helpSkipButton ||
  !legendOverlay ||
  !legendCloseButton ||
  !posterLink ||
  !pulseControls ||
  !pulseUndoButton ||
  !pulseClearButton ||
  !pulsePlayButton
) {
  throw new Error('Event Horizon shell is missing required DOM nodes.');
}

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') === 'legacy' ? 'legacy' : 'pulse-chain';
const debugInput = params.get('debugInput') === '1';
const seed = params.get('seed') ?? 'tutorial-002';

const game: EventHorizonRuntime =
  mode === 'legacy'
    ? new EventHorizonGame(root, {
        seed: 'eh-2026-05-29-alpha',
        startedAt: 1780051200000
      })
    : new PulseMode(root, {
        seed,
        startedAt: Date.now()
      });

await game.start();
game.setInputDebug(debugInput);
pulseControls.hidden = mode === 'legacy';
let pulsePaused = false;

const helpKey = mode === 'legacy' ? 'eventHorizon.helpSeen' : 'eventHorizon.iteration05HelpSeen';

const hasSeenHelp = (): boolean => {
  try {
    return localStorage.getItem(helpKey) === '1';
  } catch {
    return false;
  }
};

const markHelpSeen = (): void => {
  try {
    localStorage.setItem(helpKey, '1');
  } catch {
    // localStorage can be unavailable in locked-down browser modes.
  }
};

const openHelp = (): void => {
  helpOverlay.hidden = false;
  helpPlayButton.textContent = mode === 'legacy' ? 'PLAY' : 'START TUTORIAL';
  helpSkipButton.hidden = mode === 'legacy';
  game.setPaused(true);
};

const openLegend = (): void => {
  legendOverlay.hidden = false;
  game.setPaused(true);
};

const closeLegend = (): void => {
  legendOverlay.hidden = true;
  if (helpOverlay.hidden) {
    game.setPaused(false);
  }
};

const closeHelp = (startTutorial: boolean): void => {
  helpOverlay.hidden = true;
  markHelpSeen();
  if (game instanceof PulseMode) {
    if (startTutorial) {
      game.startTutorial();
    } else {
      game.skipTutorial();
    }
  }
  game.setPaused(false);
  updatePulseControls();
};

if (!hasSeenHelp()) {
  openHelp();
}

restartButton.addEventListener('click', () => {
  posterLink.removeAttribute('href');
  pulsePaused = false;
  game.restart();
  updatePulseControls();
});

helpButton.addEventListener('click', openHelp);
legendButton.addEventListener('click', openLegend);
legendCloseButton.addEventListener('click', closeLegend);
helpPlayButton.addEventListener('click', () => closeHelp(true));
helpSkipButton.addEventListener('click', () => closeHelp(false));

shareButton.addEventListener('click', async () => {
  const poster = await game.exportPoster();
  posterLink.href = poster;
});

if (game instanceof PulseMode) {
  pulseUndoButton.addEventListener('click', () => {
    const snapshot = game.getSnapshot();
    if (snapshot.phase === 'build') {
      game.undo();
    } else if (snapshot.phase === 'pulse') {
      pulsePaused = !pulsePaused;
      game.setPaused(pulsePaused);
    } else if (snapshot.endReason === 'pulse-died') {
      pulsePaused = false;
      game.fixChain();
    } else {
      pulsePaused = false;
      game.restart();
    }
    updatePulseControls();
  });
  pulseClearButton.addEventListener('click', () => {
    const snapshot = game.getSnapshot();
    if (snapshot.phase === 'build') {
      game.clearLinks();
    } else {
      pulsePaused = false;
      game.restart();
    }
    updatePulseControls();
  });
  pulsePlayButton.addEventListener('click', () => {
    if (game.getSnapshot().phase === 'build') {
      game.playPulse();
      pulsePaused = false;
      updatePulseControls();
    } else if (game.getSnapshot().phase === 'ended') {
      const nextSeed = `seed-${Date.now().toString(36)}`;
      window.location.href = `${window.location.pathname}?seed=${encodeURIComponent(nextSeed)}`;
    }
  });
  window.setInterval(updatePulseControls, 250);
  updatePulseControls();
} else {
  pulseControls.hidden = true;
}

function updatePulseControls(): void {
  if (!(game instanceof PulseMode)) {
    return;
  }
  const controls = pulseControls;
  const undoButton = pulseUndoButton;
  const clearButton = pulseClearButton;
  const playButton = pulsePlayButton;
  if (!controls || !undoButton || !clearButton || !playButton) {
    return;
  }
  const snapshot = game.getSnapshot();
  controls.dataset.phase = snapshot.phase;
  if (snapshot.phase === 'build') {
    undoButton.hidden = false;
    clearButton.hidden = false;
    playButton.hidden = false;
    undoButton.textContent = 'Undo';
    clearButton.textContent = 'Clear';
    playButton.textContent = 'Play';
    playButton.disabled = snapshot.linksUsed === 0;
    return;
  }
  if (snapshot.phase === 'pulse') {
    undoButton.hidden = false;
    clearButton.hidden = false;
    playButton.hidden = true;
    undoButton.textContent = pulsePaused ? 'Resume' : 'Pause';
    clearButton.textContent = 'Restart';
    playButton.disabled = true;
    return;
  }
  undoButton.hidden = false;
  clearButton.hidden = false;
  playButton.hidden = false;
  undoButton.textContent = snapshot.endReason === 'pulse-died' ? 'Fix Chain' : 'Replay';
  clearButton.textContent = 'Replay';
  playButton.textContent = 'New Seed';
  playButton.disabled = false;
}

declare global {
  interface Window {
    __EVENT_HORIZON__?: {
      exportPoster: () => Promise<string>;
      forceEnd: () => void;
      getReplayPayload: () => unknown;
      getSnapshot: () => unknown;
      restart: () => void;
    };
    __EVENT_HORIZON_DEBUG__?: {
      addLink: (fromId: number, toId: number) => unknown;
      clearLinks: () => unknown;
      forceBuildPhase: () => void;
      forceCollapse: () => void;
      forceHelp: (open: boolean) => void;
      forcePulsePhase: () => void;
      getLastInputResult: () => unknown;
      getLinks: () => unknown;
      getMode: () => string;
      getNodes: () => unknown;
      getPulses: () => unknown;
      getReplayPayload: () => unknown;
      getSnapshot: () => unknown;
      playPulse: () => unknown;
      startTutorial: () => void;
      skipTutorial: () => void;
      getTutorialStep: () => unknown;
      simulateChainSwipe: (nodeIds: number[]) => unknown;
      analyzeChain: () => unknown;
      getSuggestedFixes: () => unknown;
      primeNode: (id: number) => unknown;
      cycleNode: (id: number) => unknown;
      stabilizeNode: (id: number) => unknown;
      setInputDebug: (enabled: boolean) => void;
      simulateLens: (points: { x: number; y: number }[]) => unknown;
    };
  }
}

window.__EVENT_HORIZON__ = {
  exportPoster: () => game.exportPoster(),
  forceEnd: () => game.forceEnd(),
  getReplayPayload: () => game.getReplayPayload(),
  getSnapshot: () => game.getSnapshot(),
  restart: () => game.restart()
};

window.__EVENT_HORIZON_DEBUG__ =
  game instanceof PulseMode
    ? {
        addLink: (fromId, toId) => game.addLink(fromId, toId),
        clearLinks: () => game.clearLinks(),
        forceBuildPhase: () => game.forceBuildPhase(),
        forceCollapse: () => game.forceCollapse(),
        forceHelp: (open) => {
          if (open) {
            openHelp();
          } else {
            closeHelp(false);
          }
        },
        forcePulsePhase: () => game.forcePulsePhase(),
        getLastInputResult: () => game.getLastInputResult(),
        getLinks: () => game.getLinks(),
        getMode: () => game.getMode(),
        getNodes: () => game.getNodes(),
        getPulses: () => game.getPulses(),
        getReplayPayload: () => game.getReplayPayload(),
        getSnapshot: () => game.getSnapshot(),
        playPulse: () => game.playPulse(),
        startTutorial: () => game.startTutorial(),
        skipTutorial: () => game.skipTutorial(),
        getTutorialStep: () => game.getTutorialStep(),
        simulateChainSwipe: (nodeIds) => game.simulateChainSwipe(nodeIds),
        analyzeChain: () => game.analyzeChain(),
        getSuggestedFixes: () => game.getSuggestedFixes(),
        primeNode: (id) => game.primeNode(id),
        cycleNode: (id) => game.cycleNode(id),
        stabilizeNode: (id) => game.stabilizeNode(id),
        setInputDebug: (enabled) => game.setInputDebug(enabled),
        simulateLens: (points) => game.simulateLens(points)
      }
    : {
        addLink: () => undefined,
        clearLinks: () => undefined,
        forceBuildPhase: () => undefined,
        forceCollapse: () => game.forceEnd(),
        forceHelp: (open) => {
          if (open) {
            openHelp();
          } else {
            closeHelp(false);
          }
        },
        forcePulsePhase: () => undefined,
        getLastInputResult: () => undefined,
        getLinks: () => [],
        getMode: () => 'legacy',
        getNodes: () => [],
        getPulses: () => [],
        getReplayPayload: () => game.getReplayPayload(),
        getSnapshot: () => game.getSnapshot(),
        playPulse: () => undefined,
        startTutorial: () => undefined,
        skipTutorial: () => undefined,
        getTutorialStep: () => undefined,
        simulateChainSwipe: () => undefined,
        analyzeChain: () => undefined,
        getSuggestedFixes: () => [],
        primeNode: () => undefined,
        cycleNode: () => undefined,
        stabilizeNode: () => undefined,
        setInputDebug: (enabled) => game.setInputDebug(enabled),
        simulateLens: () => undefined
      };
