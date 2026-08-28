import { chromium } from 'playwright';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = 30, OUT = join(HERE, 'frames');
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--force-color-profile=srgb','--font-render-hinting=none'] });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
await p.goto('file://' + join(HERE, 'scene-v2.html'), { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
const total = Math.round(await p.evaluate(() => window.VIDEO_DURATION) * FPS);
console.log('frames', total);
for (let i = 0; i < total; i++) {
  await p.evaluate((t) => window.setT(t), i / FPS);
  await p.screenshot({ path: join(OUT, String(i).padStart(5,'0') + '.png'), animations: 'disabled' });
  if (i % 120 === 0) console.log(i, '/', total);
}
await b.close(); console.log('done');
