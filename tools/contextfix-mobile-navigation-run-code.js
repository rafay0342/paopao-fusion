async (page) => {
  const expectedRelease = 'r5-level100-production-contextfix-20260722';
  const expectedSchema = 20;
  const canvas = page.locator('#game canvas');
  await page.bringToFront();

  const readReport = async () => page.evaluate(() => {
    const diagnostics = window.__PAOPAO_PRODUCTION__;
    return diagnostics && typeof diagnostics.report === 'function'
      ? diagnostics.report()
      : null;
  });
  const waitScene = async (scene, timeout = 120000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const report = await readReport();
      if (report?.activeScenes?.includes(scene)) return report;
      await page.waitForTimeout(250);
    }
    throw new Error('Timed out waiting for scene ' + scene);
  };
  const clickCanvasPoint = async (x, y) => {
    const box = await canvas.boundingBox();
    const intrinsic = await canvas.evaluate((element) => ({
      width: element.width,
      height: element.height,
    }));
    if (!box || !intrinsic.width || !intrinsic.height) {
      throw new Error('Canvas geometry unavailable');
    }
    await page.mouse.click(
      box.x + x * box.width / intrinsic.width,
      box.y + y * box.height / intrinsic.height,
    );
  };

  let preflightReloads = 0;
  let cleanIntro = null;
  for (let attempt = 0; attempt < 3 && !cleanIntro; attempt += 1) {
    if (attempt > 0) {
      preflightReloads += 1;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    }
    await canvas.waitFor({ state: 'visible', timeout: 180000 });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const report = await readReport();
      if (report?.contextLossCount > 0 || report?.contextRestoredCount > 0) break;
      if (report?.activeScenes?.includes('Intro')
        && report.renderer === 'webgl'
        && report.contextStatus === 'ready'
        && !report.contextLost) {
        cleanIntro = report;
        break;
      }
      await page.waitForTimeout(500);
    }
  }
  if (!cleanIntro) {
    throw new Error('A clean zero-loss Intro preflight could not be established');
  }

  await clickCanvasPoint(643, 48);
  await waitScene('Menu');
  await clickCanvasPoint(360, 322);
  await waitScene('ModeSelect');
  await clickCanvasPoint(548, 438);
  await waitScene('WorldMap');
  await page.waitForTimeout(900);
  await clickCanvasPoint(236, 420);
  await waitScene('Story');
  await page.keyboard.press('Space');
  await waitScene('Game');

  let passingReport = null;
  const passingDeadline = Date.now() + 180000;
  while (Date.now() < passingDeadline) {
    const report = await readReport();
    if (report?.contextLossCount > 0 || report?.contextRestoredCount > 0 || report?.contextLost) {
      throw new Error('WebGL context continuity failed during mobile preflight');
    }
    if (report?.activeScenes?.length === 1
      && report.activeScenes[0] === 'Game'
      && report.renderer === 'webgl'
      && report.contextStatus === 'ready'
      && report.snapshot.averageFps >= 30
      && report.snapshot.p95FrameMs <= 33
      && report.snapshot.budget === 'pass') {
      passingReport = report;
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (!passingReport) throw new Error('Mobile Game/WebGL performance preflight timed out');

  const deployment = await page.evaluate(async () => {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const health = await response.json();
    return {
      ok: response.ok,
      status: response.status,
      release: response.headers.get('x-paopao-release'),
      schemaVersion: health.schemaVersion,
    };
  });
  if (!deployment.ok) throw new Error('Health preflight failed: ' + deployment.status);
  if (deployment.release !== expectedRelease || deployment.schemaVersion !== expectedSchema) {
    throw new Error('Unexpected deployment identity: ' + deployment.release
      + ' / schema ' + deployment.schemaVersion);
  }
  return {
    url: page.url(),
    release: deployment.release,
    schemaVersion: deployment.schemaVersion,
    preflightReloads,
    diagnostic: passingReport,
  };
}
