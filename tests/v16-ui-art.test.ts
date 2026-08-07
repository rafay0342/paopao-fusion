import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const readText = (path: string): string => readFileSync(projectFile(path), 'utf8');

describe('V16 production UI art', () => {
  const manifest = JSON.parse(readText('public/assets/ui/v16/ui-art-manifest.json')) as {
    columns: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
    sheets: Record<string, { file: string; elements: string[] }>;
  };

  it('ships six complete semantic sprite sheets', () => {
    expect(Object.keys(manifest.sheets)).toHaveLength(6);
    expect(manifest).toMatchObject({ columns: 4, rows: 3, cellWidth: 362, cellHeight: 362 });

    for (const sheet of Object.values(manifest.sheets)) {
      expect(sheet.elements).toHaveLength(12);
      const path = projectFile(`public/assets/ui/v16/${sheet.file}`);
      expect(existsSync(path), `${sheet.file} should ship`).toBe(true);
      expect(statSync(path).size, `${sheet.file} should contain rendered art`).toBeGreaterThan(100_000);
    }
  });

  it('preloads the generated art before scenes render', () => {
    const loader = readText('src/gfx/ui-art-v16.ts');
    const boot = readText('src/scenes/BootScene.ts');
    expect(loader).toContain('export function queueV16UiArt');
    expect(loader).toContain("frameWidth: 362, frameHeight: 362");
    expect(boot).toContain('queueV16UiArt(this)');
  });

  it('uses semantic art in shared UI and core game surfaces', () => {
    const ui = readText('src/gfx/ui.ts');
    expect(ui).toContain('UI_V16.panelWide');
    expect(ui).toContain('UI_V16.buttonPrimary');
    expect(ui).toContain('UI_V16.medallion');

    const integrations = [
      ['src/scenes/GameScene.ts', 'UI_V16_FRAME.hud'],
      ['src/scenes/WorldMapScene.ts', 'UI_V16_FRAME.map'],
      ['src/scenes/ModeSelectScene.ts', 'UI_V16_FRAME.map'],
      ['src/scenes/InventoryScene.ts', 'UI_V16_FRAME.inventory'],
    ] as const;
    for (const [path, marker] of integrations) expect(readText(path)).toContain(marker);
  });
});
