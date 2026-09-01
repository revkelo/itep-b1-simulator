// Monta la app de verdad en jsdom y comprueba que el landing se pinta, que el
// panel de importar funciona y que ya no queda nada de generar con IA.
import fs from 'fs';
import { JSDOM } from 'jsdom';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const examData = fs.readFileSync(ROOT + 'public/data/exam-data.json', 'utf8');

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost:3000/',
  pretendToBeVisual: true
});

const { window } = dom;
global.window = window;
global.document = window.document;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.HTMLElement = window.HTMLElement;
global.Blob = window.Blob;
global.FileReader = window.FileReader;
global.localStorage = window.localStorage;
global.URL = window.URL;
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
global.fetch = async (u) => ({ ok: true, status: 200, json: async () => JSON.parse(examData) });
global.speechSynthesis = { getVoices: () => [], speak() {}, cancel() {} };
window.speechSynthesis = global.speechSynthesis;

// El modulo usa import.meta.env de Vite; se sustituye por un objeto plano.
let src = fs.readFileSync(ROOT + 'src/main.js', 'utf8').replace(/\r/g, '');
src = src.replace(/import\.meta\.env\.BASE_URL/g, '"/"')
         .replace(/import\.meta\.env\.VITE_GROQ_API_KEY/g, '""');
const tmp = ROOT + 'src/.render-test.tmp.mjs';
fs.writeFileSync(tmp, src);

let fallos = 0;
const check = (label, cond, extra = '') => {
  console.log((cond ? 'ok   ' : 'FALLA') + '  ' + label + (extra ? '  ' + extra : ''));
  if (!cond) fallos++;
};

try {
  await import('file:///' + tmp + '?v=' + Date.now());
  await new Promise((r) => setTimeout(r, 200));

  const app = window.document.getElementById('app');
  const html = () => app.innerHTML;

  check('el landing se pinta', html().includes('iTEP Practice Simulator'));
  check('el logo esta en la cabecera', /<img[^>]+logo\.svg/.test(html()));

  // El reparto: la pieza. Los porcentajes tienen que salir de los timeLimit y
  // los weight del examen cargado, no estar escritos a mano en la plantilla.
  const datos = JSON.parse(examData).tests[0].sections;
  const segs = ['grammar', 'listening', 'reading', 'writing', 'speaking'];
  const totalSeg = segs.reduce((a, k) => a + datos[k].timeLimit, 0);
  const esperado = Object.fromEntries(
    segs.map((k) => [k, ((datos[k].timeLimit / totalSeg) * 100).toFixed(2)])
  );

  check('las dos barras estan', /barra--tiempo/.test(html()) && /barra--puntaje/.test(html()));
  check(
    'el total en minutos sale de los datos',
    html().includes(String(Math.round(totalSeg / 60)) + ' min'),
    Math.round(totalSeg / 60) + ' min'
  );

  const anchos = {};
  for (const t of app.querySelectorAll('.barra--tiempo .tramo')) {
    anchos[t.dataset.sec] = t.style.flexBasis.replace('%', '');
  }
  const cuadran = segs.every((k) => Number(anchos[k]).toFixed(2) === esperado[k]);
  check('cada tramo se dibuja a escala real del reloj', cuadran,
    segs.map((k) => k[0] + ':' + Number(anchos[k]).toFixed(0) + '%').join(' '));

  const pesos = [...app.querySelectorAll('.barra--puntaje .tramo')]
    .map((t) => Number(t.style.flexBasis.replace('%', '')));
  check('la barra de puntaje es plana: todas valen lo mismo',
    pesos.length === 5 && pesos.every((p) => Math.abs(p - 20) < 0.01));

  check('senala Writing como el que se come la hora',
    /Writing is where the hour disappears/.test(html()));

  // Mirar una seccion tiene que encender las dos barras y la fila de la tabla
  app.querySelector('.barra--tiempo .tramo[data-sec="reading"]')
     .dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  const encendidos = app.querySelectorAll('[data-mirado]').length;
  check('mirar un tramo enciende sus tres parejas', encendidos === 3, encendidos + ' elementos');
  check('estan los dos modos', html().includes('Start exam mode') && html().includes('Start study mode'));
  check('no queda nada de generar con IA',
    !/Generate New Exam|with AI|GROQ API key/i.test(html()));
  check('el panel de importar esta plegado', !html().includes('Choose JSON file'));

  // Abrir el panel de importar
  app.querySelector('[data-action="toggle-import"]').click();
  await new Promise((r) => setTimeout(r, 50));
  check('el panel abre', html().includes('Choose JSON file'));
  check('ofrece descargar la plantilla', html().includes('Download template'));
  check('enlaza a examia para generar', html().includes('examia.kgstudio.top'));
  check('no ofrece volver al de fabrica todavia', !html().includes('Back to built-in exam'));

  // Importar un examen valido pegado
  const propio = JSON.parse(examData).tests[0];
  propio.title = 'My own exam';
  // El valor del textarea vive en el estado, asi que hay que disparar `input`
  // como lo haria una persona escribiendo.
  const escribir = (txt) => {
    const ta = app.querySelector('#examPaste');
    ta.value = txt;
    ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  };

  escribir(JSON.stringify({ test: propio }));
  app.querySelector('[data-action="import-pasted"]').click();
  await new Promise((r) => setTimeout(r, 50));
  check('importa un examen valido', html().includes('Loaded "My own exam"'), '');
  check('lo marca como importado', html().includes('lnd-badge-imported'));
  check('ahora si ofrece volver al de fabrica', html().includes('Back to built-in exam'));

  escribir('esto no es json');
  app.querySelector('[data-action="import-pasted"]').click();
  await new Promise((r) => setTimeout(r, 50));
  check('rechaza lo que no es JSON', html().includes('lnd-msg-error'));

  // JSON valido pero sin examen
  escribir('{"hola":"mundo"}');
  app.querySelector('[data-action="import-pasted"]').click();
  await new Promise((r) => setTimeout(r, 50));
  check('rechaza JSON sin sections', /no exam inside it/.test(html()));
  check('conserva lo que el usuario pego', html().includes('{"hola":"mundo"}'));

  // Volver al de fabrica
  app.querySelector('[data-action="reset-exam"]').click();
  await new Promise((r) => setTimeout(r, 50));
  check('vuelve al examen de fabrica', html().includes('Back to the built-in exam'));
  check('quita la marca de importado', !html().includes('lnd-badge-imported'));
} catch (e) {
  console.log('EXCEPCION ' + e.stack);
  fallos++;
} finally {
  fs.unlinkSync(tmp);
}

console.log('\n' + (fallos ? fallos + ' fallo(s)' : 'todo en verde'));
process.exit(fallos ? 1 : 0);
