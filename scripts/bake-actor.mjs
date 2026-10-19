import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { launchBrowser } from './browser.mjs';

const source = new URL('../reference/original-coastal-ride.html', import.meta.url);
let html = await readFile(source, 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replaceAll('requestAnimationFrame(tick);', '');
const end = html.lastIndexOf('})();');
html = html.slice(0, end) + `
window.__sampleActor = function(time) {
  tRide = time; tEnv = time; render(0);
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="350" height="300" viewBox="235 40 700 600">' + document.querySelector('#scene defs').outerHTML + bikeG.outerHTML + '</svg>';
};
` + html.slice(end);
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent(html);
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4200; canvas.height = 3600;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 144; i++) {
      // Three complete crank turns also close four wheel turns exactly.
      const svg = window.__sampleActor(i / 144 * 1.65 * 3);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.drawImage(img, (i % 12) * 350, Math.floor(i / 12) * 300);
      URL.revokeObjectURL(url);
    }
    const b = document.querySelector('#pelicanBicycle').getBBox();
    return { png: canvas.toDataURL('image/png').split(',')[1], bbox: { x: b.x, y: b.y, width: b.width, height: b.height } };
  });
  const output = new URL('../public/assets/', import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('pelican-riding.png', output), Buffer.from(result.png, 'base64'));
  console.log(JSON.stringify({ frames: 144, width: 350, height: 300, bbox: result.bbox }));
} finally { await browser.close(); }
