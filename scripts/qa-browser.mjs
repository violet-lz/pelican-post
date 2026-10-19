import { launchBrowser } from './browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const report = { checks: [], screenshots: [], errors };
const output = new URL('../qa/', import.meta.url);
await mkdir(output, { recursive: true });
async function record(name, data = true) { report.checks.push({ name, data }); console.log(JSON.stringify({ name, data })); }
async function shot(name) {
  const path = new URL(`${name}.png`, output).pathname;
  await page.screenshot({ path: decodeURIComponent(path), animations: 'disabled', timeout: 15000 });
  report.screenshots.push(name + '.png');
}
try {
  await page.goto('http://127.0.0.1:5178/');
  await page.waitForFunction(() => document.querySelector('.save-card .button')?.disabled === false);
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.homeSeconds > 1.3);
  await shot('01-home');
  await page.getByRole('button', { name: '开始旅行' }).first().click();
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.mode === 'playing');
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.overlay), 'none');
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.save.player.x >= 55);
  await page.keyboard.press('e');
  await page.waitForSelector('.station-panel');
  const before = await page.evaluate(() => window.__PELICAN_DEV__.engine.save.worldSeconds);
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('checkbox').nth(2).check();
  await page.getByRole('checkbox').nth(3).check();
  assert(await page.getByRole('checkbox').nth(4).isDisabled());
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.worldSeconds), before);
  await shot('02-post-office');
  await record('Fresh save cruises directly; E opens roadside drawer; four-slot capacity; interaction freezes clock', { seconds: before });
  await page.getByRole('button', { name: '装好 4 封信，继续骑行' }).click();
  await page.waitForSelector('.station-panel', { state: 'detached' });
  const pickups = await page.evaluate(() => window.__PELICAN_DEV__.engine.save.bag.map(l => l.pickedAt));
  assert.equal(new Set(pickups).size, 1);
  // Reposition only in this isolated QA context to exercise actual game inputs promptly.
  await page.evaluate(async () => {
    const { REGIONS } = await import('/src/world/regions.ts');
    const e = window.__PELICAN_DEV__.engine;
    const visit = e.save.routes.visits[e.save.routes.active];
    e.save.player.x = visit.length * REGIONS.coast.addresses[0].fraction - 6;
    e.save.player.speed = 0;
    e.publish();
  });
  await page.keyboard.press('e');
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.stats.delivered), 0, 'Wrong road must not deliver');
  await page.keyboard.press('w');
  await page.waitForFunction(() => !window.__PELICAN_DEV__.engine.laneChanging);
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.save.stats.delivered === 1);
  await record('W changes smoothly; manual E delivery obeys road and grants one reward', await page.evaluate(() => ({ bag: window.__PELICAN_DEV__.engine.save.bag.length, record: window.__PELICAN_DEV__.engine.save.history[0] })));
  await page.getByRole('button', { name: '打开骑行设置' }).click();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.evaluate(async () => {
    const { REGIONS } = await import('/src/world/regions.ts');
    const e = window.__PELICAN_DEV__.engine; const visit = e.save.routes.visits[e.save.routes.active];
    e.save.player.x = visit.length * REGIONS.coast.addresses[1].fraction - 6;
    e.save.player.speed = 0; e.publish();
  });
  await page.keyboard.press('s');
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.save.stats.delivered === 2);
  await page.keyboard.press('e');
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.stats.delivered), 2);
  await record('Auto delivery shares settlement with manual E and cannot double-reward');
  await page.evaluate(() => { const e = window.__PELICAN_DEV__.engine; e.save.player.x = 900; e.save.player.speed = 0; });
  await page.keyboard.down('a');
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.save.player.speed < -3);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.facing), 1);
  await page.keyboard.up('a');
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.save.player.speed === 0);
  const parked = await page.evaluate(() => ({ x: window.__PELICAN_DEV__.engine.save.player.x, seconds: window.__PELICAN_DEV__.engine.save.worldSeconds }));
  await page.waitForFunction((seconds) => window.__PELICAN_DEV__.engine.save.worldSeconds > seconds + 1, parked.seconds);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.x), parked.x);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.cruiseActive), false);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.visual.turn === 1 && window.__PELICAN_DEV__.engine.save.player.facing === -1);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.speed), 0);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.cruiseActive), false);
  await record('A reverse release settles to exact zero with no drift; roadside clocks continue; Q turns without restarting cruise');
  await page.keyboard.press('Escape');
  const frozen = await page.evaluate(() => ({ time: window.__PELICAN_DEV__.engine.save.worldSeconds, x: window.__PELICAN_DEV__.engine.save.player.x }));
  await page.evaluate(() => { const e = window.__PELICAN_DEV__.engine; for (let i = 0; i < 100; i++) e.update(.1); });
  assert.deepEqual(await page.evaluate(() => ({ time: window.__PELICAN_DEV__.engine.save.worldSeconds, x: window.__PELICAN_DEV__.engine.save.player.x })), frozen);
  await page.getByRole('button', { name: '手账', exact: true }).click();
  await shot('03-journal');
  await page.getByRole('button', { name: '关闭手账' }).click();
  await page.evaluate(async () => { const e = window.__PELICAN_DEV__.engine; e.setOverlay('pause'); await e.persist(); });
  const saved = await page.evaluate(() => ({ seconds: window.__PELICAN_DEV__.engine.save.worldSeconds, count: window.__PELICAN_DEV__.engine.save.stats.delivered, bag: window.__PELICAN_DEV__.engine.save.bag.length }));
  await page.reload();
  await page.getByRole('button', { name: '继续骑行' }).first().click();
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.mode === 'playing');
  await page.evaluate(() => window.__PELICAN_DEV__.engine.setOverlay('pause'));
  const restored = await page.evaluate(() => ({ seconds: window.__PELICAN_DEV__.engine.save.worldSeconds, count: window.__PELICAN_DEV__.engine.save.stats.delivered, bag: window.__PELICAN_DEV__.engine.save.bag.length, auto: window.__PELICAN_DEV__.engine.save.preferences.autoDelivery }));
  assert.equal(restored.count, saved.count); assert.equal(restored.bag, saved.bag); assert(restored.auto); assert(restored.seconds - saved.seconds < 1);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.cruiseActive), false);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.speed), 0);
  await page.getByRole('button', { name: '继续，去下一处风景' }).click();
  await page.keyboard.press('d');
  await page.waitForFunction(() => { const p = window.__PELICAN_DEV__.engine.save.player; return p.cruiseActive && p.speed * p.facing > 1; });
  await page.evaluate(() => window.__PELICAN_DEV__.engine.setOverlay('pause'));
  await record('Parking persists through pause and immediate reload; a fresh D press resumes cruise after release');
  await record('Pause and reload preserve letters, rewards, automation and effective time; offline time is excluded', restored);
  const other = await context.newPage(); await other.goto('http://127.0.0.1:5178/');
  await other.getByRole('button', { name: '继续骑行' }).first().click();
  await other.waitForSelector('.global-error');
  assert.match(await other.locator('.global-error').innerText(), /另一个标签页/);
  await page.bringToFront();
  await other.close();
  await page.waitForFunction(() => !document.hidden);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.mode), 'playing');
  await record('A second tab cannot take over an actively leased save');
  const corruption = await page.evaluate(async () => {
    const { readSlot, writeSlot } = await import('/src/storage/saves.ts');
    const e = window.__PELICAN_DEV__.engine;
    await e.persist(); await e.persist(); await e.persist();
    const db = await new Promise((resolve,reject) => { const r=indexedDB.open('pelican-post-saves',1); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
    await new Promise((resolve,reject) => { const tx=db.transaction('snapshots','readwrite'); const store=tx.objectStore('snapshots'); const get=store.get(e.save.slot); get.onsuccess=()=>{const rows=get.result; rows[0]={version:999}; store.put(rows,e.save.slot);}; tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error); });
    const recovered = await readSlot(e.save.slot); db.close();
    if (!recovered.recovered || recovered.save.stats.delivered !== e.save.stats.delivered) throw Error('Recovery snapshot failed');
    await e.persist();
    return { recovered: recovered.recovered, delivered: recovered.save.stats.delivered };
  });
  await record('A broken current snapshot recovers from the two previous snapshots', corruption);
  const stress = await page.evaluate(async () => {
    const { advanceRegion } = await import('/src/world/routes.ts');
    const { REGIONS, REGION_IDS } = await import('/src/world/regions.ts');
    const { validateSave, writeSlot, readSlot } = await import('/src/storage/saves.ts');
    const e = window.__PELICAN_DEV__.engine;
    e.save.stats.delivered = 80;
    let maxObjects = 0, maxChunks = 0, maxBytes = 0, maxRegions = 0;
    for (let i = 0; i < 100; i++) {
      const visit = e.save.routes.visits[e.save.routes.active];
      const next = REGIONS[visit.region].neighbors.filter(r => r !== visit.region)[i % 2];
      const result = advanceRegion(e.save, next);
      if (!result.entered) throw Error('Failed region transition');
      e.save.player.x = e.save.routes.visits[e.save.routes.active].length * .3;
      e.resetVisual(); e.updateChunks(); e.publish();
      validateSave(e.save);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      for (let wait = 0; wait < 60 && !window.__PELICAN_DEV__.diagnostics().residentRegions.includes(next); wait++) await new Promise(requestAnimationFrame);
      const d = window.__PELICAN_DEV__.diagnostics();
      maxObjects = Math.max(maxObjects, d.displayObjects); maxChunks = Math.max(maxChunks, d.chunks);
      maxBytes = Math.max(maxBytes, d.textureBytes); maxRegions = Math.max(maxRegions, d.residentRegions.length);
      if (d.region !== next || !d.residentRegions.includes(next)) throw Error('Expected region was not rendered');
      if (e.save.routes.visits.length > 2 || d.chunks > 5 || d.displayObjects > 1200 || d.textureBytes > d.limits.textureBytes || d.residentRegions.length > 3) throw Error('Resource bounds exceeded');
    }
    let forbiddenWriter = false;
    try { await writeSlot(e.save, 'someone-else'); } catch { forbiddenWriter = true; }
    if (!forbiddenWriter) throw Error('Unowned save write accepted');
    return { transitions: 100, maxObjects, maxChunks, maxTextureBytes: maxBytes, maxResidentRegions: maxRegions, forbiddenWriterRejected: forbiddenWriter, visits: e.save.routes.visits.length };
  });
  await record('100 rendered region transitions keep scene, chunk, texture and two-region state bounded; storage enforces writer ownership', stress);
  // Inspect distinct geography and bridge connection in the renderer.
  await page.evaluate(async () => {
    const { makeVisit } = await import('/src/game/mail.ts');
    const e = window.__PELICAN_DEV__.engine;
    e.save.routes.visits = [makeVisit(e.save.seed, 'desert', 500, 80)]; e.save.routes.active = 0;
    e.save.player.x = e.save.routes.visits[0].length * .12; e.save.player.lane = 3; e.save.player.coins = 120;
    e.resetVisual(); e.updateChunks(); e.overlay = 'none'; e.hasLease = true; e.publish();
  });
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.visual.transition > .9 && window.__PELICAN_DEV__.diagnostics().region === 'desert' && window.__PELICAN_DEV__.diagnostics().fade > .95 && !window.__PELICAN_DEV__.diagnostics().transitioning);
  await shot('04-desert');
  await page.evaluate(() => {
    const e = window.__PELICAN_DEV__.engine; e.save.player.x=e.save.routes.visits[0].length*.565; e.save.player.lane=3; e.save.player.speed=0; e.resetVisual(); e.updateChunks(); e.publish();
  });
  await page.keyboard.press('e');
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.overlay === 'shop');
  const prior = await page.evaluate(() => ({ capacity:window.__PELICAN_DEV__.engine.save.player.capacity, coins:window.__PELICAN_DEV__.engine.save.player.coins, seconds:window.__PELICAN_DEV__.engine.save.worldSeconds }));
  await page.keyboard.press('1');
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.capacity), prior.capacity+1);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.worldSeconds), prior.seconds);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.coins), prior.coins-60);
  await page.waitForFunction(() => !window.__PELICAN_DEV__.diagnostics().transitioning);
  await shot('07-roadside-shop');
  await page.keyboard.press('e');
  await record('Roadside shop buys a modest capacity upgrade with key 1 and keeps scene visible');
  await page.evaluate(() => {
    const e = window.__PELICAN_DEV__.engine; e.save.player.x = e.save.routes.visits[0].length * .27; e.save.player.lane = 2; e.resetVisual(); e.updateChunks(); e.publish();
  });
  await page.keyboard.press('w');
  await page.waitForFunction(() => !window.__PELICAN_DEV__.engine.laneChanging);
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.lane), 1);
  await shot('05-high-bridge');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开骑行设置' }).click();
  await shot('06-mobile-settings');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await record('High-bridge ramp entry works; mobile settings remain within viewport');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存并返回主页' }).click();
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.mode === 'home');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.save-card').nth(0).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出邮路 一备份' }).click(),
  ]);
  const backupPath = decodeURIComponent(new URL('exported-test-save.json',output).pathname);
  await download.saveAs(backupPath);
  await page.locator('input[type=file]').setInputFiles(backupPath);
  await page.waitForSelector('.import-modal');
  await page.locator('.import-slot-label select').selectOption('2');
  await page.getByRole('button', { name: '确认导入到这个槽位' }).click();
  await page.waitForSelector('.import-modal', {state:'detached'});
  await page.locator('.save-card').nth(1).getByRole('button', {name:'继续骑行'}).click();
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.mode === 'playing' && window.__PELICAN_DEV__.engine.save.slot === 2);
  await page.evaluate(() => window.__PELICAN_DEV__.engine.setOverlay('pause'));
  assert.equal(await page.evaluate(() => window.__PELICAN_DEV__.engine.save.player.capacity), prior.capacity+1);
  await record('Export and import into a chosen second slot preserve purchases without replacing the original');
  assert.deepEqual(errors, []);
  await record('No uncaught browser errors');
} catch (error) {
  report.failure = { message: String(error), stack: error.stack };
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(new URL('browser-results.json', output), JSON.stringify(report, null, 2));
  await context.close(); await browser.close();
}
