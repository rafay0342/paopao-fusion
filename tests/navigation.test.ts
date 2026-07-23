import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('../src/game/navigation.ts', import.meta.url)), 'utf8');

describe('navigation ownership and route restoration', () => {
  it('stores scene launch data instead of returning every back route to defaults', () => {
    expect(source).toContain('scene.events.on(Phaser.Scenes.Events.READY');
    expect(source).not.toContain('scene.events.on(Phaser.Scenes.Events.START');
    expect(source).toContain('stack.push({ scene: current.scene, data: routeData(current.data) })');
    expect(source).toContain('current = { scene: next, data: routeData(data) }');
    expect(source).toContain("scene.scene.start(previous?.scene ?? fallback, previous?.data)");
  });

  it('gives Escape one owner and pauses Game rather than abandoning the attempt', () => {
    expect(source).toContain("const sceneOwnedEscape = new Set(['Menu', 'Chronicle'])");
    expect(source).toContain("active.events.emit('paopao:back-request')");
    expect(source).toContain('event.defaultPrevented');
    expect(source).toContain('editableTarget(event.target)');
  });

  it('does not trap browser Back at the root and removes global listeners', () => {
    expect(source).toContain("active.scene.key === 'Menu'");
    expect(source).toContain('history.back()');
    expect(source).toContain("window.removeEventListener('keydown', handleKeyDown)");
    expect(source).toContain("window.removeEventListener('popstate', handlePopState)");
  });
});
