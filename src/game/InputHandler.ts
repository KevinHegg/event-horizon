import {
  makeSwipeGesture,
  screenPathLength,
  worldPathLength,
  type GesturePoint,
  type SwipeGesture,
  type WorldPoint
} from './gestures';

export type { GesturePoint, SwipeGesture, WorldPoint } from './gestures';

export interface GestureEndResult {
  kind: 'tap' | 'swipe' | 'canceled';
  gesture?: SwipeGesture;
  point?: GesturePoint;
  canceled: boolean;
}

export interface InputDebugInfo {
  enabled: boolean;
  lastPointerEventType: string;
  lastGestureKind: GestureEndResult['kind'] | 'none';
  lastScreenDistance: number;
  lastWorldDistance: number;
  worldStart?: WorldPoint;
  worldEnd?: WorldPoint;
}

export interface InputCallbacks {
  screenToWorld: (clientX: number, clientY: number) => WorldPoint;
  onTap: (point: GesturePoint) => void;
  onSwipe: (gesture: SwipeGesture) => void;
  onGesturePreview?: (points: readonly GesturePoint[]) => void;
  onGestureEnd?: (result: GestureEndResult) => void;
}

export class InputHandler {
  private activePointerId: number | null = null;
  private activeTouchId: number | null = null;
  private points: GesturePoint[] = [];
  private debugInfo: InputDebugInfo = {
    enabled: false,
    lastPointerEventType: 'none',
    lastGestureKind: 'none',
    lastScreenDistance: 0,
    lastWorldDistance: 0
  };
  private readonly supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;
  private readonly swipeThresholdPx = 20;

  constructor(
    private readonly target: HTMLElement,
    private readonly callbacks: InputCallbacks
  ) {
    this.target.addEventListener('contextmenu', this.preventDefault, { passive: false });
    this.target.addEventListener('selectstart', this.preventDefault, { passive: false });

    if (this.supportsPointerEvents) {
      this.target.addEventListener('pointerdown', this.handlePointerDown, { passive: false });
      this.target.addEventListener('pointermove', this.handlePointerMove, { passive: false });
      this.target.addEventListener('pointerup', this.handlePointerUp, { passive: false });
      this.target.addEventListener('pointercancel', this.handlePointerCancel, { passive: false });
    } else {
      this.target.addEventListener('touchstart', this.handleTouchStart, { passive: false });
      this.target.addEventListener('touchmove', this.handleTouchMove, { passive: false });
      this.target.addEventListener('touchend', this.handleTouchEnd, { passive: false });
      this.target.addEventListener('touchcancel', this.handleTouchCancel, { passive: false });
    }
  }

  destroy(): void {
    this.target.removeEventListener('contextmenu', this.preventDefault);
    this.target.removeEventListener('selectstart', this.preventDefault);
    this.target.removeEventListener('pointerdown', this.handlePointerDown);
    this.target.removeEventListener('pointermove', this.handlePointerMove);
    this.target.removeEventListener('pointerup', this.handlePointerUp);
    this.target.removeEventListener('pointercancel', this.handlePointerCancel);
    this.target.removeEventListener('touchstart', this.handleTouchStart);
    this.target.removeEventListener('touchmove', this.handleTouchMove);
    this.target.removeEventListener('touchend', this.handleTouchEnd);
    this.target.removeEventListener('touchcancel', this.handleTouchCancel);
  }

  setDebug(enabled: boolean): void {
    this.debugInfo.enabled = enabled;
  }

  getDebugInfo(): InputDebugInfo {
    return {
      ...this.debugInfo,
      worldStart: this.debugInfo.worldStart ? { ...this.debugInfo.worldStart } : undefined,
      worldEnd: this.debugInfo.worldEnd ? { ...this.debugInfo.worldEnd } : undefined
    };
  }

  private readonly preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.recordEventType(event.type);
    event.preventDefault();
    if (this.activePointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    this.activePointerId = event.pointerId;
    try {
      this.target.setPointerCapture?.(event.pointerId);
    } catch {
      // Some mobile browsers throw when capture races element removal or cancellation.
    }
    this.startGesture(this.makePoint(event.clientX, event.clientY, event.timeStamp));
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this.recordEventType(event.type);
    event.preventDefault();
    const coalesced = this.getCoalescedPointerEvents(event);
    for (const sample of coalesced) {
      this.addPoint(this.makePoint(sample.clientX, sample.clientY, sample.timeStamp));
    }
    this.previewGesture();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this.recordEventType(event.type);
    event.preventDefault();
    this.addPoint(this.makePoint(event.clientX, event.clientY, event.timeStamp));
    this.finishGesture(false);
    this.resetPointer(event.pointerId);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this.recordEventType(event.type);
    event.preventDefault();
    this.addPoint(this.makePoint(event.clientX, event.clientY, event.timeStamp));
    this.finishGesture(true);
    this.resetPointer(event.pointerId);
  };

  private readonly handleTouchStart = (event: TouchEvent): void => {
    this.recordEventType(event.type);
    event.preventDefault();
    if (this.activeTouchId !== null || event.changedTouches.length === 0) {
      return;
    }
    const touch = event.changedTouches[0];
    this.activeTouchId = touch.identifier;
    this.startGesture(this.makePoint(touch.clientX, touch.clientY, event.timeStamp));
  };

  private readonly handleTouchMove = (event: TouchEvent): void => {
    const touch = this.findActiveTouch(event.changedTouches);
    if (!touch) {
      return;
    }
    this.recordEventType(event.type);
    event.preventDefault();
    this.addPoint(this.makePoint(touch.clientX, touch.clientY, event.timeStamp));
    this.previewGesture();
  };

  private readonly handleTouchEnd = (event: TouchEvent): void => {
    const touch = this.findActiveTouch(event.changedTouches);
    if (!touch) {
      return;
    }
    this.recordEventType(event.type);
    event.preventDefault();
    this.addPoint(this.makePoint(touch.clientX, touch.clientY, event.timeStamp));
    this.finishGesture(false);
    this.activeTouchId = null;
  };

  private readonly handleTouchCancel = (event: TouchEvent): void => {
    const touch = this.findActiveTouch(event.changedTouches);
    if (!touch) {
      return;
    }
    this.recordEventType(event.type);
    event.preventDefault();
    this.addPoint(this.makePoint(touch.clientX, touch.clientY, event.timeStamp));
    this.finishGesture(true);
    this.activeTouchId = null;
  };

  private startGesture(point: GesturePoint): void {
    this.points = [point];
    this.debugInfo.lastGestureKind = 'none';
    this.updateDebugDistances();
    this.previewGesture();
  }

  private addPoint(point: GesturePoint): void {
    const previous = this.points[this.points.length - 1];
    if (previous && previous.screenX === point.screenX && previous.screenY === point.screenY) {
      return;
    }
    this.points.push(point);
    this.updateDebugDistances();
  }

  private previewGesture(): void {
    this.callbacks.onGesturePreview?.(this.points);
  }

  private finishGesture(canceled: boolean): void {
    if (this.points.length === 0) {
      return;
    }

    const gesture = this.points.length > 1 ? makeSwipeGesture(this.points) : undefined;
    if (canceled) {
      this.debugInfo.lastGestureKind = 'canceled';
      this.callbacks.onGestureEnd?.({ kind: 'canceled', gesture, point: this.points[0], canceled: true });
      this.points = [];
      return;
    }

    if (gesture && gesture.screenDistance >= this.swipeThresholdPx) {
      this.debugInfo.lastGestureKind = 'swipe';
      this.callbacks.onSwipe(gesture);
      this.callbacks.onGestureEnd?.({ kind: 'swipe', gesture, canceled: false });
    } else {
      const point = this.points[this.points.length - 1];
      this.debugInfo.lastGestureKind = 'tap';
      this.callbacks.onTap(point);
      this.callbacks.onGestureEnd?.({ kind: 'tap', gesture, point, canceled: false });
    }
    this.points = [];
  }

  private resetPointer(pointerId: number): void {
    try {
      this.target.releasePointerCapture?.(pointerId);
    } catch {
      // Ignore capture-release races; the gesture has already been finalized.
    }
    this.activePointerId = null;
  }

  private findActiveTouch(touches: TouchList): Touch | undefined {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch && touch.identifier === this.activeTouchId) {
        return touch;
      }
    }
    return undefined;
  }

  private getCoalescedPointerEvents(event: PointerEvent): readonly PointerEvent[] {
    if (typeof event.getCoalescedEvents !== 'function') {
      return [event];
    }
    const coalesced = event.getCoalescedEvents();
    return coalesced.length > 0 ? coalesced : [event];
  }

  private makePoint(clientX: number, clientY: number, timeStamp: number): GesturePoint {
    const world = this.callbacks.screenToWorld(clientX, clientY);
    return {
      x: world.x,
      y: world.y,
      screenX: clientX,
      screenY: clientY,
      t: timeStamp || performance.now()
    };
  }

  private updateDebugDistances(): void {
    const first = this.points[0];
    const last = this.points[this.points.length - 1];
    this.debugInfo.lastScreenDistance = screenPathLength(this.points);
    this.debugInfo.lastWorldDistance = worldPathLength(this.points);
    this.debugInfo.worldStart = first ? { x: first.x, y: first.y } : undefined;
    this.debugInfo.worldEnd = last ? { x: last.x, y: last.y } : undefined;
  }

  private recordEventType(type: string): void {
    this.debugInfo.lastPointerEventType = type;
  }
}
