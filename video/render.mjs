/* 逐格渲染 scene.html → frames/*.png，再交給 ffmpeg 合成 mp4 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = Number(process.env.FPS || 30);
const W = 1080, H = 1920;
const OUT = join(HERE, 'frames');

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto('file://' + join(HERE, 'scene.html'), { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const dur = await page.evaluate(() => window.VIDEO_DURATION);
const total = Math.round(dur * FPS);
console.log(`renderering ${total} frames @ ${FPS}fps (${dur}s)`);

for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.setT(t), i / FPS);
  await page.screenshot({ path: join(OUT, String(i).padStart(5, '0') + '.png'), animations: 'disabled' });
  if (i % 60 === 0) console.log(`  ${i}/${total}`);
}
await browser.close();
console.log('frames done');
