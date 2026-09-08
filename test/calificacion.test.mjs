/*
 * La calificacion de Writing y Speaking.
 *
 * Esta parte estuvo rota mucho tiempo sin que nada se quejara: la llave de
 * Groq no estaba puesta en ningun sitio, asi que no se transcribia ni se
 * evaluaba nada, y las dos secciones caian a una "nota de avance" que daba 72
 * sobre 100 por haber apretado grabar. Compilaba, pasaba las pruebas y el
 * informe entregaba una banda CEFR con dos quintas partes regaladas.
 *
 * De ahi lo que se comprueba aqui: que la llave no viaje al navegador, que
 * `_nucleo.js` sanee lo que devuelve el modelo, y que sin nota la seccion se
 * declare no calificada en vez de rellenarse sola.
 */

import fs from 'fs';
import { evaluar, transcribir } from '../api/_nucleo.js';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let fallos = 0;
const check = (etiqueta, cond, extra = '') => {
  console.log((cond ? 'ok   ' : 'FALLA') + '  ' + etiqueta + (extra ? '  ' + extra : ''));
  if (!cond) fallos++;
};

/* ── La llave no puede acabar en el navegador ────────────────────────── */

const cliente = fs.readFileSync(ROOT + 'src/main.js', 'utf8');

check(
  'el cliente no lee ninguna variable VITE_ de Groq',
  !/VITE_GROQ/.test(cliente),
  'Vite mete toda variable VITE_ en el paquete que descarga el visitante'
);
check(
  'el cliente no llama a api.groq.com',
  !/api\.groq\.com/.test(cliente),
  'la llave iria en la cabecera, a la vista de cualquiera'
);
check(
  'el cliente habla con /api',
  /\/api\/transcribir/.test(cliente) && /\/api\/evaluar/.test(cliente)
);

/* Y el paquete construido tampoco, que es lo que se sirve de verdad. */
const dist = ROOT + 'dist/assets';
if (fs.existsSync(dist)) {
  const juntos = fs.readdirSync(dist)
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(dist + '/' + f, 'utf8'))
    .join('');
  check('el paquete construido no trae una llave de Groq', !/gsk_[A-Za-z0-9]{20}/.test(juntos));
} else {
  console.log('nota   sin dist/: se salta la revision del paquete construido');
}

/* ── Lo que devuelve el modelo se sanea antes de entrar en la nota ───── */

const originalFetch = globalThis.fetch;
const responder = (contenido) => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(contenido) } }] })
  });
};

process.env.GROQ_API_KEY = 'gsk_llave_de_prueba';

responder({ score: '87', cefr: 'c1', fluency: 90, pronunciation: 95, feedback: 'Bien.' });
let r = await evaluar('speaking', 'Consigna', 'Una respuesta cualquiera.');
check('la nota en texto se convierte a numero', r.ok && r.juicio.score === 87, JSON.stringify(r.juicio?.score));
check('el nivel en minusculas se normaliza', r.ok && r.juicio.cefr === 'C1');
check(
  'no se deja pasar pronunciation',
  r.ok && r.juicio.pronunciation === undefined,
  'se calificaba leyendo una transcripcion, sin oir nada'
);

responder({ score: 250, cefr: 'Z9', feedback: '' });
r = await evaluar('speaking', 'Consigna', 'Otra respuesta.');
check('la nota se acota a 100', r.ok && r.juicio.score === 100, String(r.juicio?.score));
check('un nivel inventado se reemplaza por el que toca a esa nota', r.ok && r.juicio.cefr === 'C2', r.juicio?.cefr);

responder({ cefr: 'B2', feedback: 'Sin nota.' });
r = await evaluar('speaking', 'Consigna', 'Otra mas.');
check(
  'sin una nota usable se falla en vez de devolver NaN',
  !r.ok && r.codigo === 'formato',
  'un NaN aqui se suma a la banda y sale un informe con NaN'
);

/* Una respuesta vacia no se le manda al modelo: no hay nada que leer. */
r = await evaluar('speaking', 'Consigna', '   ');
check('una respuesta vacia no llega a gastar una llamada', !r.ok && r.codigo === 'vacio');

/* ── Sin llave, se dice; no se inventa una nota ──────────────────────── */

delete process.env.GROQ_API_KEY;
r = await evaluar('speaking', 'Consigna', 'Da igual lo que diga.');
check('sin llave, evaluar avisa con su propio codigo', !r.ok && r.codigo === 'sin_llave');
const t = await transcribir(Buffer.from([1, 2, 3]), 'audio/webm');
check('sin llave, transcribir avisa con su propio codigo', !t.ok && t.codigo === 'sin_llave');

globalThis.fetch = originalFetch;

/* ── La nota final no premia el haber apretado grabar ────────────────── */

check(
  'ya no queda la nota de avance de Writing',
  !/writingProgressScore/.test(cliente),
  '72 sobre 100 por llegar al minimo de palabras'
);
check(
  'ya no queda la nota de avance de Speaking',
  !/speakingProgressScore/.test(cliente),
  '72 sobre 100 por haber grabado'
);
check(
  'la banda se reparte solo entre las secciones que si se midieron',
  /calificadas\.reduce/.test(cliente) && /pesoTotal/.test(cliente)
);
check(
  'el informe dice cuales no se calificaron',
  /sinCalificar/.test(cliente) && /not scored/i.test(cliente)
);
check(
  'ya no se reescala Writing y Speaking por 72',
  !/rpt\.writing \/ 72/.test(cliente),
  'venia de la escala de la nota de avance e inflaba la nota real un 39%'
);

console.log('\n' + (fallos ? fallos + ' fallo(s)' : 'todo en verde'));
process.exit(fallos ? 1 : 0);
