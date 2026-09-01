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
  check('estan los dos modos', html().includes('Start Exam Mode') && html().includes('Start Study Mode'));
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
