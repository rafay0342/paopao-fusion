import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { containVideoLayout, containVideoScale } from '../src/gfx/videoLayout';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const introSource = readFileSync(projectFile('src/scenes/IntroScene.ts'), 'utf8');

describe('intro video contain layout', () => {
  it.each([
    {
      name: 'final portrait render in the authored portrait canvas',
      source: [1080, 1920], viewport: [720, 1280], expected: [2 / 3, 720, 1280],
    },
    {
      name: 'portrait render in a landscape canvas',
      source: [1080, 1920], viewport: [1280, 720], expected: [0.375, 405, 720],
    },
    {
      name: 'landscape render in a portrait canvas',
      source: [1920, 1080], viewport: [720, 1280], expected: [0.375, 720, 405],
    },
    {
      name: 'portrait render in a tall mobile viewport',
      source: [1080, 1920], viewport: [390, 844], expected: [390 / 1080, 390, 1920 * (390 / 1080)],
    },
    {
      name: 'square render in a tall mobile viewport',
      source: [1000, 1000], viewport: [390, 844], expected: [0.39, 390, 390],
    },
  ])('$name', ({ source, viewport, expected }) => {
    const [sourceWidth, sourceHeight] = source;
    const [viewportWidth, viewportHeight] = viewport;
    const [expectedScale, expectedWidth, expectedHeight] = expected;
    const layout = containVideoLayout(sourceWidth, sourceHeight, viewportWidth, viewportHeight);

    expect(containVideoScale(sourceWidth, sourceHeight, viewportWidth, viewportHeight)).toBeCloseTo(expectedScale, 10);
    expect(layout.scale).toBeCloseTo(expectedScale, 10);
    expect(layout.x).toBeCloseTo(viewportWidth / 2, 10);
    expect(layout.y).toBeCloseTo(viewportHeight / 2, 10);
    expect(layout.renderedWidth).toBeCloseTo(expectedWidth, 10);
    expect(layout.renderedHeight).toBeCloseTo(expectedHeight, 10);
    expect(layout.renderedWidth / layout.renderedHeight).toBeCloseTo(sourceWidth / sourceHeight, 10);
    expect(layout.renderedWidth).toBeLessThanOrEqual(viewportWidth + Number.EPSILON);
    expect(layout.renderedHeight).toBeLessThanOrEqual(viewportHeight + Number.EPSILON);

    const touchesHorizontalEdge = Math.abs(layout.renderedWidth - viewportWidth) < 1e-8;
    const touchesVerticalEdge = Math.abs(layout.renderedHeight - viewportHeight) < 1e-8;
    expect(touchesHorizontalEdge || touchesVerticalEdge).toBe(true);
  });

  it('rejects incomplete media or viewport dimensions instead of producing invalid transforms', () => {
    expect(() => containVideoLayout(0, 1920, 720, 1280)).toThrow(RangeError);
    expect(() => containVideoLayout(1080, Number.NaN, 720, 1280)).toThrow(RangeError);
    expect(() => containVideoLayout(1080, 1920, -1, 1280)).toThrow(RangeError);
    expect(() => containVideoLayout(1080, 1920, 720, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('IntroScene video integration invariants', () => {
  it('waits for natural video sizing before applying one contain scale', () => {
    expect(introSource).toMatch(/import\s*\{[^}]*\bcontainVideoLayout\b[^}]*\}\s*from\s*['"]\.\.\/gfx\/videoLayout['"]/s);
    expect(introSource).toContain('Phaser.GameObjects.Events.VIDEO_CREATED');
    expect(introSource).not.toContain('Phaser.GameObjects.Events.VIDEO_TEXTURE');
    expect(introSource).toMatch(/containVideoLayout\s*\(/);
    expect(introSource).toMatch(/video\.setScale\(\s*[A-Za-z_$][\w$]*\.scale\s*\)/);
    expect(introSource).not.toMatch(/\bvideo\.setDisplaySize\s*\(/);
  });

  it('keeps the responsive FIT canvas contract', () => {
    const mainSource = readFileSync(projectFile('src/main.ts'), 'utf8');
    const html = readFileSync(projectFile('index.html'), 'utf8');

    expect(mainSource).toContain('mode: Phaser.Scale.FIT');
    expect(mainSource).toContain('autoCenter: Phaser.Scale.CENTER_BOTH');
    expect(html).toMatch(/#game\s*\{[\s\S]*?width:\s*100vw;/);
    expect(html).toMatch(/#game\s*\{[\s\S]*?height:\s*100dvh;/);
  });

  it('loads the exact final-light render and always retains it as fallback', () => {
    const videoUrl = introSource.match(/const VIDEO_URL = ['"]([^'"]+)['"];/)?.[1];
    expect(videoUrl).toBe('assets/cinematics/paopao-opening-final-light-1080.mp4');
    expect(introSource).toContain('return [VIDEO_URL]');
    expect(introSource).toContain('return [hdSource, VIDEO_URL]');
    expect(introSource).toContain('video.loadURL(sources[sourceIndex]');
    expect(introSource).not.toContain('paopao-opening-v2.mp4');
    expect(introSource).not.toContain('paopao-fusion-clean-full-stitch-rafaygen-outro-4k-ai.mp4');

    const finalLight = readFileSync(projectFile(`public/${videoUrl}`));
    expect(createHash('sha256').update(finalLight).digest('hex'))
      .toBe('eda9d2f2725069c7fa01066bfbafd62dc9630d1b65a405a9818677ca80d68b5c');
  });
});
