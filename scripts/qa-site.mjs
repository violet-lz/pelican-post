import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5179/pelican-post/';
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const failedResources = [];
const checks = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', (response) => { if (response.status() >= 400) failedResources.push({ status: response.status(), url: response.url() }); });
const output = new URL('../qa/', import.meta.url);
await mkdir(output, { recursive: true });
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '开始旅行' }).first().click();
  await page.locator('.speed-readout strong').waitFor();
  await page.waitForFunction(() => Number(document.querySelector('.speed-readout strong')?.textContent) > 15);
  checks.push('Production site and actor assets load from the project subdirectory; new save cruises');

  // Holding D before braking must not restart the bike when A is released.
  await page.keyboard.down('d');
  await page.keyboard.down('a');
  await page.locator('.parking-hint').waitFor();
  await page.waitForFunction(() => Number(document.querySelector('.speed-readout strong')?.textContent) >= 5);
  await page.keyboard.up('a');
  await page.waitForFunction(() => document.querySelector('.parking-hint')?.textContent.includes('已停稳'));
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', repeat: true, bubbles: true })));
  const position = await page.locator('.region-chip small').innerText();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('.region-chip small').innerText(), position);
  assert.equal(await page.locator('.speed-readout strong').innerText(), '0');
  checks.push('Reverse release settles to zero; an already-held or repeating D does not restart cruise');
  await page.keyboard.up('d');
  await page.keyboard.press('q');
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.speed-readout strong').innerText(), '0');
  checks.push('Q changes facing while remaining parked');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存并返回主页' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '继续骑行', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('.parking-hint')?.textContent.includes('已停稳'));
  const restoredPosition = await page.locator('.region-chip small').innerText();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('.region-chip small').innerText(), restoredPosition);
  await page.screenshot({ path: fileURLToPath(new URL('production-parked.png', output)) });
  checks.push('Parking survives save, home, immediate reload and resuming the saved trip');

  await page.keyboard.press('d');
  await page.waitForFunction(() => Number(document.querySelector('.speed-readout strong')?.textContent) > 5);
  assert.equal(await page.locator('.parking-hint').count(), 0);
  await page.getByRole('button', { name: /当前远视野/ }).click();
  await page.getByRole('button', { name: /当前近视野/ }).waitFor();
  checks.push('A fresh D press restores cruise; camera controls still work');
  assert.deepEqual(errors, []);
  assert.deepEqual(failedResources, []);
  console.log(JSON.stringify({ url, checks, errors, failedResources }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(new URL('site-results.json', output), JSON.stringify({ url, checks, errors, failedResources, passed: !process.exitCode }, null, 2));
  await context.close();
  await browser.close();
}
