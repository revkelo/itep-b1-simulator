import { chromium } from 'playwright';
const salida = process.argv[2];
const nav = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-capture', '--autoplay-policy=no-user-gesture-required']
});
const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 120)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
const red = [];
p.on('request', (r) => { const u = r.url(); if (u.includes('groq') || u.includes('api.')) red.push(r.method() + ' ' + u.slice(0, 70)); });

await p.goto('http://localhost:3007/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
await p.getByRole('button', { name: /start study mode/i }).click();
await p.waitForTimeout(1200);
// El chequeo de dispositivos
const cont = p.getByRole('button', { name: /continue to (study|exam) mode/i });
if (await cont.count()) { await cont.click(); await p.waitForTimeout(900); }
// Los cortes entre secciones
for (let i = 0; i < 6; i++) {
  const b = p.getByRole('button', { name: /^continue$/i });
  if (await b.count()) { await b.click(); await p.waitForTimeout(700); }
  const t = (await p.$eval('body', (x) => x.innerText)).slice(0, 60).replace(/\n/g, ' ');
  if (/speaking/i.test(t)) break;
  const ns = p.getByRole('button', { name: /next section/i });
  if (await ns.count()) { await ns.click(); await p.waitForTimeout(700); }
}
console.log('--- seccion actual:', (await p.$eval('body', (x) => x.innerText)).slice(0, 90).replace(/\n/g, ' | '));
await p.screenshot({ path: `${salida}/itep-speaking-1.png` });
const botones = await p.$$eval('button', (bs) => bs.map((b) => b.textContent.trim().slice(0, 34)).filter(Boolean));
console.log('--- botones:', JSON.stringify(botones));
console.log('--- peticiones externas:', JSON.stringify(red));
console.log('--- errores:', JSON.stringify(errs));
await nav.close();
