import './styles.css';
import { EventHorizonGame } from './game/EventHorizonGame';

const root = document.querySelector<HTMLDivElement>('#game-root');
const restartButton = document.querySelector<HTMLButtonElement>('#restart-button');
const shareButton = document.querySelector<HTMLButtonElement>('#share-button');
const posterLink = document.querySelector<HTMLAnchorElement>('#poster-link');

if (!root || !restartButton || !shareButton || !posterLink) {
  throw new Error('Event Horizon shell is missing required DOM nodes.');
}

const game = new EventHorizonGame(root, {
  seed: 'eh-2026-05-29-alpha',
  startedAt: 1780051200000
});

await game.start();

restartButton.addEventListener('click', () => {
  posterLink.removeAttribute('href');
  game.restart();
});

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
  }
}

window.__EVENT_HORIZON__ = {
  exportPoster: () => game.exportPoster(),
  forceEnd: () => game.forceEnd(),
  getReplayPayload: () => game.getReplayPayload(),
  getSnapshot: () => game.getSnapshot(),
  restart: () => game.restart()
};
