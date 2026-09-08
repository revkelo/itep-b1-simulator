/*
 * Genera public/og.png, la tarjeta que sale en WhatsApp, LinkedIn y X.
 *
 * La anterior estaba dibujada a mano y decía "Listening 20 min" y "Speaking
 * 5 min" cuando el examen dice 6 y 4: la primera cifra que ve un estudiante
 * era falsa. Aquí los minutos salen de public/data/exam-data.json, así que si
 * cambia el examen se vuelve a correr esto y la tarjeta no puede mentir.
 *
 *   npm run og
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const examen = JSON.parse(
  fs.readFileSync(path.join(raiz, "public/data/exam-data.json"), "utf8")
).tests[0];

const SECCIONES = [
  ["grammar", "Grammar"],
  ["listening", "Listening"],
  ["reading", "Reading"],
  ["writing", "Writing"],
  ["speaking", "Speaking"]
];

const filas = SECCIONES.map(([id, nombre]) => ({
  nombre,
  minutos: Math.round((examen.sections[id]?.timeLimit || 0) / 60)
}));
const total = filas.reduce((a, f) => a + f.minutos, 0);

const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Instrument+Sans:wght@400;600&family=Martian+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: space-between; padding: 58px 66px;
    background: linear-gradient(180deg, #3b78b4, #63a2d8); color: #ffffff;
    font-family: "Instrument Sans", system-ui, sans-serif;
  }
  .marca { display: flex; align-items: center; gap: 18px; }
  .marca img { width: 56px; height: 56px; }
  .marca strong { font-family: "Bricolage Grotesque", sans-serif; font-size: 32px; letter-spacing: -0.02em; }
  h1 { font-family: "Bricolage Grotesque", sans-serif; font-size: 78px; font-weight: 800;
       letter-spacing: -0.045em; line-height: 0.95; }
  h1 em { font-style: normal; color: #ffd60a; }
  p { font-size: 24px; color: #dbe9f9; max-width: 48ch; margin-top: 20px; }
  .tramos { display: flex; gap: 12px; }
  .t { flex: 1; border: 1px solid rgba(255,255,255,.3); border-radius: 18px; padding: 15px 17px;
       background: rgba(255,255,255,.14); }
  .t b { display: block; font-size: 20px; font-weight: 600; }
  .t span { font-family: "Martian Mono", monospace; font-size: 13px; color: #dbe9f9; }
  .pie { display: flex; align-items: baseline; justify-content: space-between; margin-top: 24px; }
  .pie span { font-family: "Martian Mono", monospace; font-size: 13px; letter-spacing: 0.06em;
              text-transform: uppercase; color: #dbe9f9; }
</style>
<div class="marca"><img src="logo.svg" alt=""><strong>iTEP Practice Simulator</strong></div>
<div>
  <h1>The whole exam.<br><em>On the real clock.</em></h1>
  <p>Five sections, real timing, a CEFR band at the end. Free, in the browser.</p>
</div>
<div>
  <div class="tramos">${filas
    .map((f) => `<div class="t"><b>${f.nombre}</b><span>${f.minutos} min</span></div>`)
    .join("")}</div>
  <div class="pie"><span>itep.kgstudio.top</span><span>${total} minutes &middot; no account</span></div>
</div>`;

const tmp = path.join(raiz, "public", ".og.tmp.html");
fs.writeFileSync(tmp, html);
try {
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1200, height: 630 } });
  await pagina.goto("file:///" + tmp.replace(/\\/g, "/"), { waitUntil: "networkidle" });
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.screenshot({ path: path.join(raiz, "public/og.png") });
  await navegador.close();
} finally {
  fs.unlinkSync(tmp);
}

console.log(
  `og.png regenerada: ${filas.map((f) => `${f.nombre} ${f.minutos}`).join(", ")}, total ${total} min`
);
