import { chromium } from 'playwright';
const salida = process.argv[2];
const nav = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-capture']
});
const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] });
const p = await ctx.newPage();
const red = [];
p.on('request', (r) => { const u = r.url(); if (/groq|openai|deepgram|api\.gro/.test(u)) red.push(r.method() + ' ' + u.slice(0, 80)); });

await p.goto('http://localhost:3007/', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.getByRole('button', { name: /start study mode/i }).click();
await p.waitForTimeout(1100);
const cont = p.getByRole('button', { name: /continue to (study|exam) mode/i });
if (await cont.count()) { await cont.click(); await p.waitForTimeout(800); }
for (let i = 0; i < 6; i++) {
  const b = p.getByRole('button', { name: /^continue$/i });
  if (await b.count()) { await b.click(); await p.waitForTimeout(600); }
  if (/Speaking/i.test((await p.$eval('body', (x) => x.innerText)).slice(0, 40))) break;
  const ns = p.getByRole('button', { name: /next section/i });
  if (await ns.count()) { await ns.click(); await p.waitForTimeout(600); }
}
// Acelerar: el temporizador de preparacion baja de uno en uno, asi que se
// espera al ciclo completo de la primera consigna (45 s de prep + 60 s de voz)
console.log('esperando prep + grabacion (unos 115 s)...');
for (let s = 0; s < 125; s += 5) {
  await p.waitForTimeout(5000);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('itep_v4_state') || '{}'));
  if (st.speakingRecordings && Object.keys(st.speakingRecordings).length) { console.log('grabacion registrada a los', s, 's'); break; }
}
await p.waitForTimeout(3000);
const st = await p.evaluate(() => JSON.parse(localStorage.getItem('itep_v4_state') || '{}'));
console.log('speakingRecordings:', JSON.stringify(st.speakingRecordings));
console.log('speakingTranscripts:', JSON.stringify(st.speakingTranscripts));
console.log('speakingEvaluation:', JSON.stringify(st.speakingEvaluation));
console.log('peticiones a Groq:', JSON.stringify(red));
await p.screenshot({ path: `${salida}/itep-speaking-2.png` });
await nav.close();
