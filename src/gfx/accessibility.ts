export type AccessibilityLivePriority = 'off' | 'polite' | 'assertive';

export interface SceneLifecycleEmitter {
  once(event: string, listener: () => void, context?: unknown): unknown;
  off?(event: string, listener: () => void, context?: unknown): unknown;
}

export interface AccessibilityRuntimeOptions {
  canvas?: HTMLElement | null;
  document?: Document;
  parent?: HTMLElement;
  gameLabel?: string;
  rootId?: string;
  headingLevel?: 1 | 2;
}

export interface AccessibilitySceneDefinition {
  id: string;
  heading: string;
  description?: string;
  status?: string;
  lifecycle?: SceneLifecycleEmitter | null;
}

export interface AccessibilityButtonDefinition {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  pressed?: boolean;
  onActivate: () => void;
  onFocusChange?: (focused: boolean) => void;
}

export interface AccessibilityButtonUpdate {
  label?: string;
  description?: string;
  disabled?: boolean;
  pressed?: boolean;
}

export interface AccessibilityButtonRegistration {
  readonly id: string;
  readonly element: HTMLButtonElement;
  focus(): void;
  update(update: AccessibilityButtonUpdate): void;
  unregister(): void;
}

export interface AccessibilityPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  forcedColors: boolean;
  reducedTransparency: boolean;
}

export interface AccessibilityMediaSource {
  matchMedia(query: string): MediaQueryList;
}

export const ACCESSIBILITY_MEDIA_QUERIES = {
  reducedMotion: '(prefers-reduced-motion: reduce)',
  increasedContrast: '(prefers-contrast: more)',
  forcedColors: '(forced-colors: active)',
  reducedTransparency: '(prefers-reduced-transparency: reduce)',
} as const;

const SCENE_LIFECYCLE_EVENTS = ['shutdown', 'destroy'] as const;
const DEFAULT_ROOT_ID = 'paopao-game-accessibility';
const DEFAULT_GAME_LABEL = 'PaoPao Fusion';

function normalizedText(value: string | undefined, fallback = ''): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized || fallback;
}

function idToken(value: string, fallback: string): string {
  return normalizedText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

function hideVisually(element: HTMLElement): void {
  Object.assign(element.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    border: '0',
    left: '0',
    top: '0',
  });
}

function styleMirrorButton(button: HTMLButtonElement, focused: boolean): void {
  if (!focused) {
    hideVisually(button);
    Object.assign(button.style, {
      bottom: 'auto',
      maxWidth: 'none',
      pointerEvents: 'none',
      background: 'transparent',
      color: 'inherit',
      borderRadius: '0',
      boxShadow: 'none',
      font: 'inherit',
      zIndex: 'auto',
    });
    return;
  }

  Object.assign(button.style, {
    position: 'fixed',
    width: 'auto',
    height: 'auto',
    minWidth: 'min(18rem, calc(100vw - 24px))',
    maxWidth: 'calc(100vw - 24px)',
    padding: '12px 16px',
    margin: '0',
    overflow: 'visible',
    clipPath: 'none',
    whiteSpace: 'normal',
    left: '12px',
    top: 'auto',
    bottom: '12px',
    pointerEvents: 'auto',
    background: '#160c32',
    color: '#fff7e8',
    border: '3px solid #8af3ff',
    borderRadius: '12px',
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.72)',
    font: '700 16px/1.35 "Fusion Sans", Arial, sans-serif',
    zIndex: '2147483647',
  });
}

function mergedIdRefs(existing: string | null, addition: string): string {
  const ids = new Set((existing ?? '').split(/\s+/).filter(Boolean));
  ids.add(addition);
  return [...ids].join(' ');
}

function resolveDocument(explicit?: Document): Document {
  if (explicit) return explicit;
  if (typeof document !== 'undefined') return document;
  throw new Error('AccessibilityRuntime requires a browser Document.');
}

function resolveMediaSource(explicit?: AccessibilityMediaSource | null): AccessibilityMediaSource | null {
  if (explicit !== undefined) return explicit;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') return window;
  return null;
}

function mediaMatches(source: AccessibilityMediaSource | null, query: string): boolean {
  if (!source) return false;
  try {
    return source.matchMedia(query).matches === true;
  } catch {
    return false;
  }
}

export function readAccessibilityPreferences(
  explicitSource?: AccessibilityMediaSource | null,
): AccessibilityPreferences {
  const source = resolveMediaSource(explicitSource);
  const forcedColors = mediaMatches(source, ACCESSIBILITY_MEDIA_QUERIES.forcedColors);
  return {
    reducedMotion: mediaMatches(source, ACCESSIBILITY_MEDIA_QUERIES.reducedMotion),
    highContrast: forcedColors || mediaMatches(source, ACCESSIBILITY_MEDIA_QUERIES.increasedContrast),
    forcedColors,
    reducedTransparency: mediaMatches(source, ACCESSIBILITY_MEDIA_QUERIES.reducedTransparency),
  };
}

export function prefersReducedMotion(explicitSource?: AccessibilityMediaSource | null): boolean {
  return readAccessibilityPreferences(explicitSource).reducedMotion;
}

export function prefersHighContrast(explicitSource?: AccessibilityMediaSource | null): boolean {
  return readAccessibilityPreferences(explicitSource).highContrast;
}

export function accessibleMotionDuration(
  durationMs: number,
  preferences: AccessibilityPreferences = readAccessibilityPreferences(),
): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || preferences.reducedMotion) return 0;
  return durationMs;
}

export function observeAccessibilityPreferences(
  listener: (preferences: AccessibilityPreferences) => void,
  explicitSource?: AccessibilityMediaSource | null,
): () => void {
  const source = resolveMediaSource(explicitSource);
  if (!source) {
    listener(readAccessibilityPreferences(null));
    return () => undefined;
  }

  const lists = Object.values(ACCESSIBILITY_MEDIA_QUERIES).map((query) => {
    try {
      return source.matchMedia(query);
    } catch {
      return null;
    }
  }).filter((query): query is MediaQueryList => query !== null);

  let listening = true;
  const snapshot = (): AccessibilityPreferences => {
    const match = (query: string): boolean => lists.find((item) => item.media === query)?.matches
      ?? mediaMatches(source, query);
    const forcedColors = match(ACCESSIBILITY_MEDIA_QUERIES.forcedColors);
    return {
      reducedMotion: match(ACCESSIBILITY_MEDIA_QUERIES.reducedMotion),
      highContrast: forcedColors || match(ACCESSIBILITY_MEDIA_QUERIES.increasedContrast),
      forcedColors,
      reducedTransparency: match(ACCESSIBILITY_MEDIA_QUERIES.reducedTransparency),
    };
  };
  const handleChange = (): void => {
    if (listening) listener(snapshot());
  };

  lists.forEach((query) => {
    if (typeof query.addEventListener === 'function') query.addEventListener('change', handleChange);
    else query.addListener?.(handleChange);
  });
  listener(snapshot());

  return () => {
    if (!listening) return;
    listening = false;
    lists.forEach((query) => {
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', handleChange);
      else query.removeListener?.(handleChange);
    });
  };
}

interface ButtonRecord {
  definition: AccessibilityButtonDefinition;
  button: HTMLButtonElement;
  description: HTMLSpanElement;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: (event: KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
  spaceArmed: boolean;
}

export class AccessibilitySceneSession {
  private active = true;
  private readonly lifecycleListener = (): void => this.dispose();

  constructor(
    private readonly runtime: AccessibilityRuntime,
    readonly id: string,
    private readonly lifecycle?: SceneLifecycleEmitter | null,
  ) {
    SCENE_LIFECYCLE_EVENTS.forEach((event) => lifecycle?.once(event, this.lifecycleListener));
  }

  get isActive(): boolean {
    return this.active && this.runtime.isSessionActive(this);
  }

  setHeading(heading: string, description?: string): void {
    if (this.isActive) this.runtime.setSceneHeading(heading, description);
  }

  setStatus(status: string): void {
    if (this.isActive) this.runtime.setSceneStatus(status);
  }

  announce(message: string, priority: AccessibilityLivePriority = 'polite'): void {
    if (this.isActive) this.runtime.announceForSession(this, message, priority);
  }

  registerButton(definition: AccessibilityButtonDefinition): AccessibilityButtonRegistration {
    if (!this.isActive) throw new Error(`Cannot register an accessibility action for inactive scene "${this.id}".`);
    return this.runtime.registerButton(definition);
  }

  buttonElement(id: string): HTMLButtonElement | undefined {
    return this.isActive ? this.runtime.buttonElement(id) : undefined;
  }

  focusButton(id: string): boolean {
    return this.isActive && this.runtime.focusButton(id);
  }

  unregisterButton(id: string): boolean {
    return this.isActive && this.runtime.unregisterButton(id);
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    SCENE_LIFECYCLE_EVENTS.forEach((event) => this.lifecycle?.off?.(event, this.lifecycleListener));
    this.runtime.releaseSession(this);
  }
}

export class AccessibilityRuntime {
  readonly rootElement: HTMLElement;
  readonly headingElement: HTMLHeadingElement;
  readonly descriptionElement: HTMLParagraphElement;
  readonly statusElement: HTMLParagraphElement;
  readonly liveElement: HTMLParagraphElement;
  readonly controlsElement: HTMLDivElement;

  private readonly document: Document;
  private readonly canvas?: HTMLElement | null;
  private readonly gameLabel: string;
  private readonly originalCanvasLabelledBy: string | null;
  private readonly originalCanvasDescribedBy: string | null;
  private readonly buttons = new Map<string, ButtonRecord>();
  private activeSession?: AccessibilitySceneSession;
  private buttonSerial = 0;
  private announcementSerial = 0;
  private disposed = false;

  constructor(options: AccessibilityRuntimeOptions = {}) {
    this.document = resolveDocument(options.document);
    this.canvas = options.canvas;
    this.gameLabel = normalizedText(options.gameLabel, DEFAULT_GAME_LABEL);
    this.originalCanvasLabelledBy = this.canvas?.getAttribute('aria-labelledby') ?? null;
    this.originalCanvasDescribedBy = this.canvas?.getAttribute('aria-describedby') ?? null;

    const rootToken = idToken(options.rootId ?? DEFAULT_ROOT_ID, DEFAULT_ROOT_ID);
    const root = this.document.createElement('section');
    root.id = rootToken;
    root.dataset.paopaoAccessibilityRoot = 'true';
    root.setAttribute('aria-label', `${this.gameLabel} accessible game interface`);
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      width: '0',
      height: '0',
      pointerEvents: 'none',
      zIndex: '2147483646',
    });

    const heading = this.document.createElement(options.headingLevel === 1 ? 'h1' : 'h2');
    heading.id = `${rootToken}-scene-heading`;
    heading.textContent = this.gameLabel;
    hideVisually(heading);

    const description = this.document.createElement('p');
    description.id = `${rootToken}-scene-description`;
    hideVisually(description);

    const status = this.document.createElement('p');
    status.id = `${rootToken}-scene-status`;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    hideVisually(status);

    const live = this.document.createElement('p');
    live.id = `${rootToken}-scene-live`;
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    hideVisually(live);

    const controls = this.document.createElement('div');
    controls.id = `${rootToken}-scene-actions`;
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Available game actions');

    root.append(heading, description, status, live, controls);
    (options.parent ?? this.document.body).append(root);

    this.rootElement = root;
    this.headingElement = heading;
    this.descriptionElement = description;
    this.statusElement = status;
    this.liveElement = live;
    this.controlsElement = controls;

    if (this.canvas) {
      this.canvas.setAttribute(
        'aria-labelledby',
        mergedIdRefs(this.originalCanvasLabelledBy, this.headingElement.id),
      );
      this.canvas.setAttribute(
        'aria-describedby',
        mergedIdRefs(this.originalCanvasDescribedBy, this.descriptionElement.id),
      );
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get currentSession(): AccessibilitySceneSession | undefined {
    return this.activeSession;
  }

  mountScene(definition: AccessibilitySceneDefinition): AccessibilitySceneSession {
    if (this.disposed) throw new Error('Cannot mount a scene on a disposed AccessibilityRuntime.');
    const id = normalizedText(definition.id);
    const heading = normalizedText(definition.heading);
    if (!id) throw new Error('Accessible scene id must not be empty.');
    if (!heading) throw new Error('Accessible scene heading must not be empty.');

    this.activeSession?.dispose();
    this.clearButtons();
    this.announcementSerial += 1;
    this.liveElement.textContent = '';
    this.liveElement.setAttribute('aria-live', 'polite');
    this.setSceneHeading(heading, definition.description);
    this.setSceneStatus(definition.status ?? '');

    const session = new AccessibilitySceneSession(this, id, definition.lifecycle);
    this.activeSession = session;
    this.rootElement.dataset.sceneId = id;
    return session;
  }

  isSessionActive(session: AccessibilitySceneSession): boolean {
    return !this.disposed && this.activeSession === session;
  }

  setSceneHeading(heading: string, description?: string): void {
    this.headingElement.textContent = normalizedText(heading, this.gameLabel);
    this.descriptionElement.textContent = normalizedText(description);
  }

  setSceneStatus(status: string): void {
    this.statusElement.textContent = normalizedText(status);
  }

  announceForSession(
    session: AccessibilitySceneSession,
    message: string,
    priority: AccessibilityLivePriority,
  ): void {
    const announcement = normalizedText(message);
    if (!announcement || !this.isSessionActive(session)) return;
    const serial = ++this.announcementSerial;
    this.liveElement.textContent = '';
    this.liveElement.setAttribute('aria-live', priority);
    queueMicrotask(() => {
      if (this.disposed || serial !== this.announcementSerial || !this.isSessionActive(session)) return;
      this.liveElement.textContent = announcement;
    });
  }

  registerButton(definition: AccessibilityButtonDefinition): AccessibilityButtonRegistration {
    if (this.disposed) throw new Error('Cannot register an action on a disposed AccessibilityRuntime.');
    const id = normalizedText(definition.id);
    const label = normalizedText(definition.label);
    if (!id) throw new Error('Accessible action id must not be empty.');
    if (!label) throw new Error(`Accessible action "${id}" must have a label.`);
    if (this.buttons.has(id)) throw new Error(`Accessible action "${id}" is already registered.`);

    const serial = ++this.buttonSerial;
    const button = this.document.createElement('button');
    const description = this.document.createElement('span');
    button.id = `${this.rootElement.id}-action-${idToken(id, 'action')}-${serial}`;
    button.type = 'button';
    button.tabIndex = 0;
    description.id = `${button.id}-description`;
    hideVisually(description);

    const record: ButtonRecord = {
      definition: { ...definition, id, label },
      button,
      description,
      spaceArmed: false,
      onClick: () => this.activateButton(id),
      onKeyDown: (event) => {
        if (event.isComposing || event.repeat || button.disabled) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          this.activateButton(id);
        } else if (event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          record.spaceArmed = true;
          button.dataset.keyboardPressed = 'true';
        }
      },
      onKeyUp: (event) => {
        if (event.key !== ' ' && event.key !== 'Spacebar') return;
        event.preventDefault();
        const activate = record.spaceArmed && !button.disabled;
        record.spaceArmed = false;
        delete button.dataset.keyboardPressed;
        if (activate) this.activateButton(id);
      },
      onFocus: () => {
        styleMirrorButton(button, true);
        record.definition.onFocusChange?.(true);
      },
      onBlur: () => {
        record.spaceArmed = false;
        delete button.dataset.keyboardPressed;
        styleMirrorButton(button, false);
        record.definition.onFocusChange?.(false);
      },
    };

    button.addEventListener('click', record.onClick);
    button.addEventListener('keydown', record.onKeyDown);
    button.addEventListener('keyup', record.onKeyUp);
    button.addEventListener('focus', record.onFocus);
    button.addEventListener('blur', record.onBlur);
    this.buttons.set(id, record);
    this.controlsElement.append(button, description);
    this.updateButtonRecord(record, definition);
    styleMirrorButton(button, false);

    return {
      id,
      element: button,
      focus: () => { if (this.buttons.get(id) === record && !button.disabled) button.focus(); },
      update: (update) => {
        if (this.buttons.get(id) === record) this.updateButtonRecord(record, update);
      },
      unregister: () => { this.unregisterButton(id); },
    };
  }

  buttonElement(id: string): HTMLButtonElement | undefined {
    return this.buttons.get(normalizedText(id))?.button;
  }

  focusButton(id: string): boolean {
    const button = this.buttonElement(id);
    if (!button || button.disabled) return false;
    button.focus();
    return true;
  }

  unregisterButton(id: string): boolean {
    const normalizedId = normalizedText(id);
    const record = this.buttons.get(normalizedId);
    if (!record) return false;
    this.buttons.delete(normalizedId);
    record.button.removeEventListener('click', record.onClick);
    record.button.removeEventListener('keydown', record.onKeyDown);
    record.button.removeEventListener('keyup', record.onKeyUp);
    record.button.removeEventListener('focus', record.onFocus);
    record.button.removeEventListener('blur', record.onBlur);
    record.button.remove();
    record.description.remove();
    return true;
  }

  clearButtons(): void {
    [...this.buttons.keys()].forEach((id) => this.unregisterButton(id));
  }

  releaseSession(session: AccessibilitySceneSession): void {
    if (this.activeSession !== session) return;
    this.activeSession = undefined;
    this.clearButtons();
    this.announcementSerial += 1;
    this.headingElement.textContent = this.gameLabel;
    this.descriptionElement.textContent = '';
    this.statusElement.textContent = '';
    this.liveElement.textContent = '';
    this.liveElement.setAttribute('aria-live', 'polite');
    delete this.rootElement.dataset.sceneId;
  }

  destroy(): void {
    if (this.disposed) return;
    this.activeSession?.dispose();
    this.clearButtons();
    this.disposed = true;
    this.announcementSerial += 1;
    this.rootElement.remove();

    if (this.canvas) {
      if (this.originalCanvasLabelledBy === null) this.canvas.removeAttribute('aria-labelledby');
      else this.canvas.setAttribute('aria-labelledby', this.originalCanvasLabelledBy);
      if (this.originalCanvasDescribedBy === null) this.canvas.removeAttribute('aria-describedby');
      else this.canvas.setAttribute('aria-describedby', this.originalCanvasDescribedBy);
    }
  }

  private activateButton(id: string): void {
    const record = this.buttons.get(id);
    if (!record || record.button.disabled || !this.activeSession) return;
    record.definition.onActivate();
  }

  private updateButtonRecord(record: ButtonRecord, update: AccessibilityButtonUpdate): void {
    const label = update.label === undefined
      ? record.definition.label
      : normalizedText(update.label);
    if (!label) throw new Error(`Accessible action "${record.definition.id}" must have a label.`);
    const description = update.description === undefined
      ? record.definition.description
      : normalizedText(update.description);
    const disabled = update.disabled ?? record.definition.disabled ?? false;
    const pressed = update.pressed ?? record.definition.pressed;

    record.definition = {
      ...record.definition,
      ...update,
      label,
      description,
      disabled,
      pressed,
    };
    record.button.textContent = label;
    record.button.setAttribute('aria-label', label);
    record.button.disabled = disabled;
    record.button.setAttribute('aria-disabled', String(disabled));
    record.description.textContent = description ?? '';
    if (description) record.button.setAttribute('aria-describedby', record.description.id);
    else record.button.removeAttribute('aria-describedby');
    if (typeof pressed === 'boolean') record.button.setAttribute('aria-pressed', String(pressed));
    else record.button.removeAttribute('aria-pressed');
  }
}

const runtimeByCanvas = new WeakMap<HTMLElement, AccessibilityRuntime>();

export function accessibilityRuntimeForCanvas(
  canvas: HTMLElement,
  options: Omit<AccessibilityRuntimeOptions, 'canvas'> = {},
): AccessibilityRuntime {
  const current = runtimeByCanvas.get(canvas);
  if (current && !current.isDisposed) return current;
  const runtime = new AccessibilityRuntime({ ...options, canvas });
  runtimeByCanvas.set(canvas, runtime);
  return runtime;
}

export function activeAccessibilitySceneForCanvas(
  canvas: HTMLElement,
): AccessibilitySceneSession | undefined {
  return runtimeByCanvas.get(canvas)?.currentSession;
}
