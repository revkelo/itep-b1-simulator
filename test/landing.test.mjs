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

  // La referencia de gramatica vestia con las clases del examen -tarjetas
  // azules- dentro de una portada de papel y rojo. Ahora es de la portada.
  const ref = app.querySelector('details.lp-ref');
  const refHtml = ref.innerHTML;
  check('la referencia de gramatica no usa las clases del examen',
    !/verb-tense|"vt-|class="vt/.test(refHtml));
  check('estan los doce tiempos verbales',
    ref.querySelectorAll('.ref-grupo li').length === 12,
    ref.querySelectorAll('.ref-grupo li').length + ' entradas');
  check('cada muestra marca su respuesta con la palabra, no solo con el color',
    ref.querySelectorAll('.ref-muestra').length === 3 &&
    ref.querySelectorAll('.ref-opciones .es-la-buena .ref-marca').length === 3);
  check('la referencia no se salta un nivel de encabezado',
    ref.querySelectorAll('h4').length === 0 && ref.querySelectorAll('h3').length > 0);

  // La rampa de las secciones se lee en portada.css, no en el DOM: jsdom no
  // resuelve variables CSS. El tono ES la identidad de la seccion en la barra,
  // y sus letras van en blanco encima, asi que se comprueba por contraste.
  const css = fs.readFileSync(ROOT + 'src/portada.css', 'utf8');
  const luminancia = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contraste = (a, b) => {
    const [x, y] = [luminancia(a), luminancia(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const rampa = [1, 2, 3, 4, 5].map((n) => (css.match(new RegExp('--s' + n + ': (#[0-9a-f]{6})')) || [])[1]);
  const peorTono = Math.min(...rampa.map((h) => contraste(h, '#ffffff')));
  check('los cinco tonos de seccion existen', rampa.every(Boolean), rampa.join(' '));
  check('las letras blancas se leen sobre todos los tonos',
    peorTono >= 4.5, 'el peor va a ' + peorTono.toFixed(2) + ':1');

  // El lapiz -lo que se mira y lo que se pasa del reloj- no puede confundirse
  // con la rampa, que ahora es azul entera.
  const lapiz = (css.match(/--lapiz: (#[0-9a-f]{6})/) || [])[1];
  const distancia = (a, b) => Math.hypot(...[1, 3, 5].map(
    (i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));
  const cerca = Math.min(...rampa.map((h) => distancia(h, lapiz)));
  check('el lapiz no se parece a ningun tono de la rampa',
    cerca > 120, 'a ' + cerca.toFixed(0) + ' del mas cercano');

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
