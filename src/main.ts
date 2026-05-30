import './styles.css';
import { EventHorizonGame } from './game/EventHorizonGame';

const root = document.querySelector<HTMLDivElement>('#game-root');
const restartButton = document.querySelector<HTMLButtonElement>('#restart-button');
const shareButton = document.querySelector<HTMLButtonElement>('#share-button');
const helpButton = document.querySelector<HTMLButtonElement>('#help-button');
const helpOverlay = document.querySelector<HTMLElement>('#help-overlay');
const helpPlayButton = document.querySelector<HTMLButtonElement>('#help-play-button');
const posterLink = document.querySelector<HTMLAnchorElement>('#poster-link');

if (!root || !restartButton || !shareButton || !helpButton || !helpOverlay || !helpPlayButton || !posterLink) {
  throw new Error('Event Horizon shell is missing required DOM nodes.');
}

const game = new EventHorizonGame(root, {
  seed: 'eh-2026-05-29-alpha',
  startedAt: 1780051200000
});

await game.start();

const debugInput = new URLSearchParams(window.location.search).get('debugInput') === '1';
game.setInputDebug(debugInput);

const hasSeenHelp = (): boolean => {
  try {
    return localStorage.getItem('eventHorizon.helpSeen') === '1';
  } catch {
    return false;
  }
};

const markHelpSeen = (): void => {
  try {
    localStorage.setItem('eventHorizon.helpSeen', '1');
  } catch {
    // localStorage can be unavailable in locked-down browser modes.
  }
};

const openHelp = (): void => {
  helpOverlay.hidden = false;
  helpPlayButton.textContent = game.getSnapshot().timeMs > 0 ? 'RESUME' : 'PLAY';
  game.setPaused(true);
};

const closeHelp = (): void => {
  helpOverlay.hidden = true;
  markHelpSeen();
  game.setPaused(false);
};

if (!hasSeenHelp()) {
  openHelp();
}

restartButton.addEventListener('click', () => {
  posterLink.removeAttribute('href');
  game.restart();
});

helpButton.addEventListener('click', openHelp);
helpPlayButton.addEventListener('click', closeHelp);

shareButton.addEventListener('click', async () => {
  const poster = await game.exportPoster();
  posterLink.href = poster;
});

declare global {
  interface Window {
    __EVENT_HORIZON__?: {
      exportPoster: () => Promise<string>;
      forceEnd: () => void;
      getReplayPayload: () => ReturnType<EventHorizonGame['getReplayPayload']>;
      getSnapshot: () => ReturnType<EventHorizonGame['getSnapshot']>;
      restart: () => void;
    };
    __EVENT_HORIZON_DEBUG__?: {
      forceHelp: (open: boolean) => void;
      getLastGesture: () => ReturnType<EventHorizonGame['getLastGesture']>;
      getReplayPayload: () => ReturnType<EventHorizonGame['getReplayPayload']>;
      getSnapshot: () => ReturnType<EventHorizonGame['getSnapshot']>;
      setInputDebug: (enabled: boolean) => void;
      simulateSwipeWorld: (points: { x: number; y: number }[]) => ReturnType<EventHorizonGame['simulateSwipeWorld']>;
      simulateTapWorld: (x: number, y: number) => ReturnType<EventHorizonGame['simulateTapWorld']>;
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

window.__EVENT_HORIZON_DEBUG__ = {
  forceHelp: (open) => {
    if (open) {
      openHelp();
    } else {
      closeHelp();
    }
  },
  getLastGesture: () => game.getLastGesture(),
  getReplayPayload: () => game.getReplayPayload(),
  getSnapshot: () => game.getSnapshot(),
  setInputDebug: (enabled) => game.setInputDebug(enabled),
  simulateSwipeWorld: (points) => game.simulateSwipeWorld(points),
  simulateTapWorld: (x, y) => game.simulateTapWorld(x, y)
};
