import { distanceSquared } from './math';

export interface WorldPoint {
  x: number;
  y: number;
}

export interface InputCallbacks {
  screenToWorld: (clientX: number, clientY: number) => WorldPoint;
  onTap: (point: WorldPoint) => void;
  onSwipe: (start: WorldPoint, end: WorldPoint) => void;
}

export class InputHandler {
  private activePointerId: number | null = null;
  private start: WorldPoint | null = null;
  private readonly swipeThresholdSq = 44 * 44;

  constructor(
    private readonly target: HTMLElement,
    private readonly callbacks: InputCallbacks
  ) {
    this.target.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
    this.target.addEventListener('pointermove', this.handlePointerMove, { passive: false });
    this.target.addEventListener('pointerup', this.handlePointerUp, { passive: false });
    this.target.addEventListener('pointercancel', this.handlePointerCancel, { passive: false });
  }

  destroy(): void {
    this.target.removeEventListener('pointerdown', this.handlePointerDown);
    this.target.removeEventListener('pointermove', this.handlePointerMove);
    this.target.removeEventListener('pointerup', this.handlePointerUp);
    this.target.removeEventListener('pointercancel', this.handlePointerCancel);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.activePointerId !== null) {
      return;
    }
    this.activePointerId = event.pointerId;
    this.target.setPointerCapture?.(event.pointerId);
    this.start = this.callbacks.screenToWorld(event.clientX, event.clientY);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    event.preventDefault();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId || !this.start) {
      return;
    }
    event.preventDefault();
    const end = this.callbacks.screenToWorld(event.clientX, event.clientY);
    const moved = distanceSquared(this.start.x, this.start.y, end.x, end.y);
    if (moved >= this.swipeThresholdSq) {
      this.callbacks.onSwipe(this.start, end);
    } else {
      this.callbacks.onTap(end);
    }
    this.resetPointer(event.pointerId);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.activePointerId) {
      this.resetPointer(event.pointerId);
    }
  };

  private resetPointer(pointerId: number): void {
    this.target.releasePointerCapture?.(pointerId);
    this.activePointerId = null;
    this.start = null;
  }
}
