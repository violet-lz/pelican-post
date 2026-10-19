import { launchBrowser } from './browser.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Set PELICAN_SOAK_SECONDS=7200 for the separate two-hour acceptance run.
const seconds = Number(process.env.PELICAN_SOAK_SECONDS ?? 30);
if (!Number.isFinite(seconds) || seconds < 10) throw Error('Use at least ten seconds of real rendering.');
const browser = await launchBrowser();
const context = await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const output = new URL('../qa/performance-results.json',import.meta.url);
try {
  await page.goto('http://127.0.0.1:5178/');
  await page.getByRole('button',{name:'开始旅行'}).first().click();
  await page.waitForFunction(() => window.__PELICAN_DEV__.engine.mode === 'playing');
  await page.evaluate(() => { const e=window.__PELICAN_DEV__.engine; e.save.stats.delivered=80; e.save.player.x=500; e.resetVisual(); e.updateChunks(); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await page.evaluate(async () => { for(let i=0;i<90;i++) await new Promise(requestAnimationFrame); });
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await cdp.send('Runtime.getHeapUsage');
  const result = await page.evaluate(async (duration) => {
    const intervals = [];
    const limits=window.__PELICAN_DEV__.diagnostics().limits;
    let last=performance.now(), start=last, maxObjects=0, maxChunks=0, maxBytes=0;
    while(performance.now()-start < duration*1000) {
      const stamp=await new Promise(requestAnimationFrame);
      intervals.push(stamp-last); last=stamp;
      const d=window.__PELICAN_DEV__.diagnostics();
      maxObjects=Math.max(maxObjects,d.displayObjects);maxChunks=Math.max(maxChunks,d.chunks);maxBytes=Math.max(maxBytes,d.textureBytes);
      if(d.displayObjects>limits.objects || d.chunks>limits.chunks || d.textureBytes>limits.textureBytes) throw Error('Resource budget exceeded');
    }
    const ordered=intervals.filter(n=>n>0).sort((a,b)=>a-b);
    const average=ordered.reduce((s,n)=>s+n,0)/ordered.length;
    return {realRenderingSeconds:(performance.now()-start)/1000,frames:ordered.length,averageFps:1000/average,p95FrameMs:ordered[Math.floor(ordered.length*.95)],p99FrameMs:ordered[Math.floor(ordered.length*.99)],maxObjects,maxChunks,maxTextureBytes:maxBytes,effectiveGameSeconds:window.__PELICAN_DEV__.engine.save.worldSeconds};
  },seconds);
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await cdp.send('Runtime.getHeapUsage');
  const report = { viewport:'1920×1080', ...result, beforeHeapBytes:before.usedSize,afterHeapBytes:after.usedSize,heapChangePercent:(after.usedSize-before.usedSize)/before.usedSize*100,twoHourRun:seconds>=7200,errors };
  await mkdir(new URL('../qa/',import.meta.url),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  assert.deepEqual(errors,[]);
  assert(result.p95FrameMs<=25,'The p95 frame interval exceeded the 25ms target.');
} finally { await context.close(); await browser.close(); }
