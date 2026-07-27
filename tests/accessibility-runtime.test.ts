import { describe, expect, it } from 'vitest';
import {
  ACCESSIBILITY_MEDIA_QUERIES,
  AccessibilityRuntime,
  accessibleMotionDuration,
  observeAccessibilityPreferences,
  prefersHighContrast,
  prefersReducedMotion,
  readAccessibilityPreferences,
  type AccessibilityMediaSource,
  type SceneLifecycleEmitter,
} from '../src/gfx/accessibility';

type FakeListener = (event: Record<string, unknown>) => void;

class FakeElement {
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<FakeListener>>();
  parentElement: FakeElement | null = null;
  id = '';
  textContent = '';
  type = '';
  title = '';
  tabIndex = -1;
  disabled = false;

  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  append(...children: FakeElement[]): void {
    children.forEach((child) => {
      child.parentElement?.removeChild(child);
      child.parentElement = this;
      this.children.push(child);
    });
  }

  removeChild(child: FakeElement): void {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? new Set<FakeListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, details: Record<string, unknown> = {}): { defaultPrevented: boolean } {
    const event = {
      type,
      repeat: false,
      isComposing: false,
      key: '',
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...details,
    };
    this.listeners.get(type)?.forEach((listener) => listener(event));
    return event;
  }

  click(): void {
    if (!this.disabled) this.dispatch('click');
  }

  focus(): void {
    if (this.disabled) return;
    const previous = this.ownerDocument.activeElement;
    if (previous === this) return;
    previous?.dispatch('blur');
    this.ownerDocument.activeElement = this;
    this.dispatch('focus');
  }
}

class FakeDocument {
  readonly body = new FakeElement(this, 'BODY');
  activeElement: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName.toUpperCase());
  }
}

class FakeLifecycle implements SceneLifecycleEmitter {
  private readonly listeners = new Map<string, Set<() => void>>();

  once(event: string, listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set<() => void>();
    const once = (): void => {
      this.off(event, once);
      listener();
    };
    listeners.add(once);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string): void {
    [...(this.listeners.get(event) ?? [])].forEach((listener) => listener());
  }
}

class FakeMediaQueryList {
  readonly listeners = new Set<() => void>();

  constructor(readonly media: string, public matches: boolean) {}

  addEventListener(type: string, listener: () => void): void {
    if (type === 'change') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'change') this.listeners.delete(listener);
  }

  setMatches(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((listener) => listener());
  }
}

class FakeMediaSource implements AccessibilityMediaSource {
  readonly queries = new Map<string, FakeMediaQueryList>();

  matchMedia(query: string): MediaQueryList {
    let list = this.queries.get(query);
    if (!list) {
      list = new FakeMediaQueryList(query, false);
      this.queries.set(query, list);
    }
    return list as unknown as MediaQueryList;
  }

  set(query: string, matches: boolean): void {
    this.matchMedia(query);
    this.queries.get(query)!.setMatches(matches);
  }
}

const setupRuntime = (): {
  document: FakeDocument;
  canvas: FakeElement;
  runtime: AccessibilityRuntime;
} => {
  const document = new FakeDocument();
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-labelledby', 'existing-title');
  document.body.append(canvas);
  const runtime = new AccessibilityRuntime({
    document: document as unknown as Document,
    canvas: canvas as unknown as HTMLElement,
    gameLabel: 'PaoPao Fusion',
  });
  return { document, canvas, runtime };
};

describe('accessibility runtime', () => {
  it('keeps persistent scene semantics and cleans scene-owned state on Phaser lifecycle shutdown', async () => {
    const { document, canvas, runtime } = setupRuntime();
    const lifecycle = new FakeLifecycle();
    const scene = runtime.mountScene({
      id: 'luma-orchard',
      heading: 'Luma Orchard',
      description: 'Aim and launch matching bubbles.',
      status: 'Ready. Twelve bubbles remain.',
      lifecycle,
    });

    expect(document.body.children).toContain(runtime.rootElement as unknown as FakeElement);
    expect(runtime.headingElement.textContent).toBe('Luma Orchard');
    expect(runtime.descriptionElement.textContent).toBe('Aim and launch matching bubbles.');
    expect(runtime.statusElement.getAttribute('role')).toBe('status');
    expect(runtime.statusElement.getAttribute('aria-live')).toBe('polite');
    expect(canvas.getAttribute('aria-labelledby')).toContain(runtime.headingElement.id);
    expect(canvas.getAttribute('aria-describedby')).toBe(runtime.descriptionElement.id);

    scene.setStatus('Aiming at the blue cluster.');
    scene.announce('Blue cluster selected.', 'assertive');
    await Promise.resolve();
    expect(runtime.statusElement.textContent).toBe('Aiming at the blue cluster.');
    expect(runtime.liveElement.textContent).toBe('Blue cluster selected.');
    expect(runtime.liveElement.getAttribute('aria-live')).toBe('assertive');

    scene.registerButton({ id: 'shoot', label: 'Launch bubble', onActivate: () => undefined });
    lifecycle.emit('shutdown');
    expect(scene.isActive).toBe(false);
    expect(runtime.rootElement.parentElement).toBe(document.body as unknown as HTMLElement);
    expect(runtime.headingElement.textContent).toBe('PaoPao Fusion');
    expect(runtime.controlsElement.children).toHaveLength(0);
    expect(runtime.liveElement.textContent).toBe('');

    runtime.destroy();
    expect(document.body.children).not.toContain(runtime.rootElement as unknown as FakeElement);
    expect(canvas.getAttribute('aria-labelledby')).toBe('existing-title');
    expect(canvas.getAttribute('aria-describedby')).toBeNull();
  });

  it('mirrors actions as semantic buttons with focus, Enter, Space, click and state updates', () => {
    const { runtime } = setupRuntime();
    const focusStates: boolean[] = [];
    let activations = 0;
    const scene = runtime.mountScene({ id: 'game', heading: 'Bubble board' });
    const action = scene.registerButton({
      id: 'launch',
      label: 'Launch blue bubble',
      description: 'Launch toward the selected trajectory.',
      pressed: false,
      onActivate: () => { activations += 1; },
      onFocusChange: (focused) => focusStates.push(focused),
    });
    const button = action.element as unknown as FakeElement;

    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.tabIndex).toBe(0);
    expect(button.getAttribute('aria-label')).toBe('Launch blue bubble');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-describedby')).toBeTruthy();

    action.focus();
    expect(focusStates).toEqual([true]);
    expect(button.style.clipPath).toBe('none');
    expect(button.style.border).toContain('#8af3ff');

    const enter = button.dispatch('keydown', { key: 'Enter' });
    button.dispatch('keydown', { key: 'Enter', repeat: true });
    expect(enter.defaultPrevented).toBe(true);
    expect(activations).toBe(1);

    button.dispatch('keydown', { key: ' ' });
    expect(activations).toBe(1);
    button.dispatch('keyup', { key: ' ' });
    button.click();
    expect(activations).toBe(3);

    action.update({ label: 'Launch gold bubble', disabled: true, pressed: true });
    expect(button.textContent).toBe('Launch gold bubble');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(activations).toBe(3);

    action.unregister();
    expect(scene.buttonElement('launch')).toBeUndefined();
    expect(runtime.controlsElement.children).toHaveLength(0);
  });

  it('atomically replaces scene mirrors so stale sessions cannot mutate the active scene', () => {
    const { runtime } = setupRuntime();
    let oldActivations = 0;
    const oldScene = runtime.mountScene({ id: 'menu', heading: 'Main menu' });
    oldScene.registerButton({
      id: 'play',
      label: 'Play',
      onActivate: () => { oldActivations += 1; },
    });
    const nextScene = runtime.mountScene({ id: 'game', heading: 'Bubble board' });

    expect(oldScene.isActive).toBe(false);
    expect(runtime.controlsElement.children).toHaveLength(0);
    oldScene.setStatus('Stale status');
    expect(runtime.statusElement.textContent).toBe('');
    expect(() => oldScene.registerButton({
      id: 'stale',
      label: 'Stale',
      onActivate: () => { oldActivations += 1; },
    })).toThrow(/inactive scene/);

    nextScene.registerButton({ id: 'pause', label: 'Pause', onActivate: () => undefined });
    expect(runtime.buttonElement('pause')).toBeTruthy();
    expect(oldActivations).toBe(0);
  });

  it('reports and observes reduced-motion and high-contrast media preferences', () => {
    const media = new FakeMediaSource();
    media.set(ACCESSIBILITY_MEDIA_QUERIES.reducedMotion, true);
    media.set(ACCESSIBILITY_MEDIA_QUERIES.increasedContrast, false);

    expect(prefersReducedMotion(media)).toBe(true);
    expect(prefersHighContrast(media)).toBe(false);
    expect(accessibleMotionDuration(420, readAccessibilityPreferences(media))).toBe(0);
    expect(accessibleMotionDuration(420, {
      reducedMotion: false,
      highContrast: false,
      forcedColors: false,
      reducedTransparency: false,
    })).toBe(420);

    const snapshots: boolean[] = [];
    const stop = observeAccessibilityPreferences((preferences) => {
      snapshots.push(preferences.highContrast);
    }, media);
    expect(snapshots).toEqual([false]);

    media.set(ACCESSIBILITY_MEDIA_QUERIES.forcedColors, true);
    expect(snapshots.at(-1)).toBe(true);
    stop();
    media.set(ACCESSIBILITY_MEDIA_QUERIES.forcedColors, false);
    expect(snapshots.at(-1)).toBe(true);
  });
});
