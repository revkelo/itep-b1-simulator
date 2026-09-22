import { chromium } from 'playwright';
const [salida, puerto] = process.argv.slice(2);
const nav = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-capture'] });
const ctx = await nav.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ['microphone'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
await p.goto(`http://localhost:${puerto}/`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
await p.getByRole('button', { name: /start study mode/i }).click();
await p.waitForTimeout(1000);
const c = p.getByRole('button', { name: /continue to (study|exam) mode/i });
if (await c.count()) { await c.click(); await p.waitForTimeout(800); }
// Contestar unas cuantas de gramatica para que esa seccion tenga nota de verdad
for (let i = 0; i < 6; i++) {
  const b = p.getByRole('button', { name: /^continue$/i });
  if (await b.count()) { await b.click(); await p.waitForTimeout(500); }
  const ops = await p.$$('.option');
  if (ops.length) { await ops[0].click(); await p.waitForTimeout(200); }
  if (/Speaking/i.test((await p.$eval('body', (x) => x.innerText)).slice(0, 40))) break;
  const ns = p.getByRole('button', { name: /next section/i });
  if (await ns.count()) { await ns.click(); await p.waitForTimeout(500); }
}
const rev = p.getByRole('button', { name: /^review$/i });
if (await rev.count()) { await rev.click(); await p.waitForTimeout(900); }
await p.screenshot({ path: `${salida}/itep-review-${puerto}.png` });
console.log('REVIEW:', (await p.$eval('body', (x) => x.innerText)).slice(0, 200).replace(/\n/g, ' | '));
const fin = p.getByRole('button', { name: /^finish$/i });
if (await fin.count()) { await fin.click(); await p.waitForTimeout(4000); }
await p.screenshot({ path: `${salida}/itep-informe-${puerto}.png` });
console.log('INFORME:', (await p.$eval('body', (x) => x.innerText)).slice(0, 620).replace(/\n/g, ' | '));
console.log('errores:', JSON.stringify(errs));
await nav.close();
