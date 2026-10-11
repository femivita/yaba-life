// Usage: node tools/preview/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { chromium } from '@playwright/test';
const [url, out, w = '900', h = '900', wait = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
if (+wait) await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
