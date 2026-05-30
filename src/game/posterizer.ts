import { WORLD_HEIGHT, WORLD_WIDTH } from './constants';
import { formatTime } from './math';
import type { PosterStats } from './types';

export interface PosterFrame {
  dataUrl: string;
  label: string;
}

export async function createSharePoster(
  frames: PosterFrame[],
  stats: PosterStats,
  targetWidth = 720,
  targetHeight = 1280
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create poster canvas context.');
  }

  const loadedFrames = await Promise.all(frames.slice(-3).map((frame) => loadImage(frame.dataUrl)));
  context.fillStyle = '#03040a';
  context.fillRect(0, 0, targetWidth, targetHeight);

  const slotHeight = Math.floor(targetHeight * 0.26);
  const top = 54;
  for (let index = 0; index < 3; index += 1) {
    const image = loadedFrames[index] ?? loadedFrames[loadedFrames.length - 1];
    if (!image) {
      continue;
    }
    const y = top + index * (slotHeight + 18);
    drawFrameCover(context, image, 48, y, targetWidth - 96, slotHeight);
    context.strokeStyle = `rgba(${90 + index * 30}, ${218 - index * 24}, 255, 0.55)`;
    context.lineWidth = 3;
    context.strokeRect(48, y, targetWidth - 96, slotHeight);
  }

  const footerY = targetHeight - 250;
  const gradient = context.createLinearGradient(0, footerY, 0, targetHeight);
  gradient.addColorStop(0, 'rgba(3, 4, 10, 0)');
  gradient.addColorStop(0.36, 'rgba(3, 4, 10, 0.88)');
  gradient.addColorStop(1, '#03040a');
  context.fillStyle = gradient;
  context.fillRect(0, footerY - 110, targetWidth, 360);

  context.fillStyle = '#f7fbff';
  context.font = '700 62px Inter, system-ui, sans-serif';
  context.fillText('EVENT HORIZON', 48, footerY);
  context.font = '700 92px Inter, system-ui, sans-serif';
  context.fillText(String(stats.score), 48, footerY + 102);
  context.font = '600 30px Inter, system-ui, sans-serif';
  context.fillStyle = '#9fe7ff';
  context.fillText(`survived ${formatTime(stats.survivalMs)}  •  phase ${stats.phase}`, 52, footerY + 154);
  context.fillStyle = '#d4f4ff';
  context.font = '500 24px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.fillText(stats.seed, 52, footerY + 204);

  return canvas.toDataURL('image/png', 0.86);
}

function drawFrameCover(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const sourceWidth = imageWidth(image);
  const sourceHeight = imageHeight(image);
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;
  const sx = x + (width - scaledWidth) / 2;
  const sy = y + (height - scaledHeight) / 2;
  context.drawImage(image, sx, sy, scaledWidth, scaledHeight);
}

function imageWidth(image: CanvasImageSource): number {
  if ('videoWidth' in image && image.videoWidth) {
    return image.videoWidth;
  }
  if ('displayWidth' in image && image.displayWidth) {
    return image.displayWidth;
  }
  return 'width' in image && typeof image.width === 'number' ? image.width : WORLD_WIDTH;
}

function imageHeight(image: CanvasImageSource): number {
  if ('videoHeight' in image && image.videoHeight) {
    return image.videoHeight;
  }
  if ('displayHeight' in image && image.displayHeight) {
    return image.displayHeight;
  }
  return 'height' in image && typeof image.height === 'number' ? image.height : WORLD_HEIGHT;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load poster frame.'));
    image.src = dataUrl;
  });
}
