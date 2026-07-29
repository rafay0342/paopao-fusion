import Phaser from 'phaser';
import { isActiveGameplayScene } from './playable-scenes';

interface RouteEntry { scene: string; data?: Record<string, unknown> }
const stack: RouteEntry[] = [];
let current: RouteEntry | null = null;
let navigatingBack = false;
const ignored = new Set(['Boot', 'Intro']);
const sceneOwnedEscape = new Set(['Menu', 'Chronicle']);

function routeData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  return data && typeof data === 'object' ? { ...data } : undefined;
}

function editableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function navigateBack(scene: Phaser.Scene, fallback = 'Menu'): void {
  navigatingBack = true;
  let previous = stack.pop();
  while (previous?.scene === scene.scene.key) previous = stack.pop();
  scene.scene.start(previous?.scene ?? fallback, previous?.data);
}

export function installNavigation(game: Phaser.Game): void {
  const attach = (): void => {
    for (const scene of game.scene.scenes) {
      // Phaser START only emits Systems. READY is the lifecycle event that
      // includes the Scene launch data after init/preload/create complete.
      scene.events.on(Phaser.Scenes.Events.READY, (_sys: unknown, data?: Record<string, unknown>) => {
        const next = scene.scene.key;
        if (current && current.scene !== next && !ignored.has(current.scene) && !navigatingBack) {
          stack.push({ scene: current.scene, data: routeData(current.data) });
        }
        if (stack.length > 24) stack.splice(0, stack.length - 24);
        current = { scene: next, data: routeData(data) };
        navigatingBack = false;
      });
    }
  };
  if (game.isBooted) attach(); else game.events.once(Phaser.Core.Events.READY, attach);
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.repeat || event.defaultPrevented || editableTarget(event.target)) return;
    const activeScenes = game.scene.getScenes(true);
    const active = activeScenes[activeScenes.length - 1];
    if (!active || ignored.has(active.scene.key) || sceneOwnedEscape.has(active.scene.key)) return;
    event.preventDefault();
    // Escape pauses gameplay through the scene's single back owner. It must
    // never skip a live attempt or race the scene's own pause state.
    if (isActiveGameplayScene(active.scene.key)) active.events.emit('paopao:back-request');
    else navigateBack(active);
  };
  const handlePopState = (): void => {
    const activeScenes = game.scene.getScenes(true);
    const active = activeScenes[activeScenes.length - 1];
    // At the root, consume no new history entry: the second back navigation is
    // allowed to leave the app instead of trapping the browser in a loop.
    if (!active || ignored.has(active.scene.key) || active.scene.key === 'Menu') {
      history.back();
      return;
    }
    if (isActiveGameplayScene(active.scene.key)) {
      active.events.emit('paopao:back-request');
      history.pushState({ paopaoGuard: true }, document.title);
      return;
    }
    navigateBack(active);
    history.pushState({ paopaoGuard: true }, document.title);
  };
  window.addEventListener('keydown', handleKeyDown);
  history.replaceState({ paopaoRoot: true }, document.title);
  history.pushState({ paopaoGuard: true }, document.title);
  window.addEventListener('popstate', handlePopState);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('popstate', handlePopState);
  });
}
