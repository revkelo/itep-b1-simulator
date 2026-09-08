# iTEP Practice Simulator

Simulador completo del examen **iTEP** construido en Vite + Vanilla JS. Recrea la experiencia real del examen con las 5 secciones, timers por sección, autosave y reporte de nivel CEFR al final.

**En producción:** <https://itep.kgstudio.top>

> Es un examen completo, no un simulacro de un solo nivel: la dificultad recorre
> la escala CEFR y el reporte ubica al candidato entre A1 y C2 según cómo
> respondió. Útil para quien debe certificar su inglés con el iTEP Academic o
> iTEP SLATE y quiere hacer un ensayo antes del examen real.

> Herramienta independiente. No está afiliada a iTEP International ni avalada por ellos.

---

## ¿Qué es el iTEP?

El **iTEP (International Test of English Proficiency)** es un examen de certificación de inglés reconocido internacionalmente, ampliamente usado por universidades latinoamericanas (incluida la Universidad El Bosque) como requisito de grado. El resultado se expresa en la escala CEFR, de **A1 a C2**.

El examen real tiene 5 secciones con tiempo limitado:

| Sección | Descripción |
|---------|-------------|
| **Grammar** | Selección múltiple de gramática y vocabulario |
| **Listening** | Comprensión auditiva con audio |
| **Reading** | Comprensión de lectura con textos |
| **Writing** | Redacción de párrafos en tiempo limitado |
| **Speaking** | Respuestas orales grabadas con tiempo de preparación |

---

## Funcionalidades del simulador

- **5 secciones completas** - Grammar · Listening · Reading · Writing · Speaking
- **Timers reales** por sección - igual que el examen oficial
- **Modo examen** y **modo estudio**
- **Autosave local** - si cierras el navegador, retoma donde dejaste
- **Revisión antes de enviar** - revisa respuestas antes del submit final
- **Reporte CEFR estimado** - calcula tu nivel (A1 → C2) al terminar, más el nivel iTEP equivalente
- **Listening con TTS** - audio generado por el navegador, sin archivos externos
- **Speaking recorder** - graba tu respuesta con el micrófono, transcribe con Web Speech API
- **Evaluación de Writing y Speaking** - feedback automático
- **Anti-refresh warning** - aviso si intentas salir durante el examen
- **Notas por sección** - apuntes durante listening y speaking

---

## Demo rápida

```bash
git clone https://github.com/revkelo/itep-b1-simulator.git
cd itep-b1-simulator
npm install
npm run dev
```

Abre `http://localhost:3000` en el navegador (el puerto está fijado en `vite.config.js`).

---

## Deploy

Desplegado en Vercel; cada push a `main` publica en `itep.kgstudio.top`.

- Build command: `npm run build`
- Output: `dist`

Todo lo de `public/` - `robots.txt`, `sitemap.xml`, `llms.txt`, `favicon.svg` y el
banco de preguntas - se copia tal cual a la raíz del build.

---

## Cambiar el banco de preguntas

Hay dos formas, y ninguna toca el código.

**Desde la app.** En la portada, `Use your own exam` abre un panel donde se
carga un `.json` o se pega directamente. `Download template` baja un ejemplo
completo con la forma exacta que espera el simulador: se llena con las
preguntas propias y se vuelve a subir. El examen importado se marca en la
portada, y `Back to built-in exam` devuelve al de fábrica.

Se acepta el JSON tal como salga de donde salga: envuelto en `{ "test": ... }`,
en el formato de `exam-data.json` con `meta` y `tests`, o el objeto pelado. Si
viene con cercas de markdown o una coma de más, se limpia solo. Si le falta una
sección, se rellena con la del examen de fábrica en vez de fallar.

**Editando el archivo.** El examen que viene por defecto está en:

```
public/data/exam-data.json
```

Contiene las secciones `grammar`, `listening`, `reading`, `writing` y `speaking`
con sus pesos, tiempos, explicaciones y metadata.

### ¿Y generarlas con IA?

Eso lo hace [examia](https://examia.kgstudio.top/), que es el sitio de la zona
dedicado a construir bancos de preguntas para cualquier examen de certificación
y exportarlos en JSON. Este simulador importa ese archivo. Separar las dos cosas
mantiene el simulador funcionando sin llaves de API y sin depender de que un
modelo responda.

---

## Calificar Speaking y Writing

Las tres secciones de opción múltiple -Grammar, Listening y Reading- se
califican solas y no necesitan nada. Las otras dos son respuestas abiertas: una
grabación de voz y un texto. Para ponerles nota hay que leerlas, y de eso se
encarga Groq.

El circuito, para Speaking:

```
graba (MediaRecorder)
  -> POST /api/transcribir   el .webm entero, en el cuerpo
     -> Groq Whisper         whisper-large-v3-turbo
  -> POST /api/evaluar       { tipo, consigna, texto, notas }
     -> Groq chat            openai/gpt-oss-120b, el mismo motor que parla
  -> { score, cefr, fluency, grammar, vocabulary, coherence, feedback }
```

Writing se salta el primer paso: ya llega escrito.

**La llave vive en el servidor.** `GROQ_API_KEY` va sin el prefijo `VITE_`,
porque Vite mete en el paquete que descarga el visitante toda variable que
empiece por ahí. La leen únicamente las funciones de `api/`, que en Vercel se
publican solas y en local las monta el servidor de Vite (ver el complemento de
`vite.config.js`), así que en desarrollo y en producción se comporta igual.

Para encenderlo:

```bash
vercel env add GROQ_API_KEY production
vercel env add GROQ_API_KEY preview
cp .env.example .env.local     # y pegar la llave, para desarrollo
```

`GET /api/estado` dice si un despliegue puede calificar, sin soltar la llave.

### Sin llave el examen funciona igual

Se hacen las cinco secciones, se graba, y Grammar, Listening y Reading se
califican. Lo que no hay es transcripción ni nota de Speaking y Writing, y **eso
se dice**: la pantalla de Speaking avisa antes de grabar, el informe marca las
dos filas como *Not scored* y la banda CEFR se reparte entre las secciones que
sí se midieron.

Eso último no es un detalle. Antes, cuando faltaba la nota, las dos secciones
caían a una "nota de avance" que daba 72 sobre 100 por haber apretado grabar o
por llegar al mínimo de palabras. Como la llave no estaba puesta en ningún
sitio, eso era lo que pasaba siempre: sesenta segundos de silencio valían lo
mismo que una respuesta perfecta, y esos puntos entraban enteros en una banda
que el sitio anuncia como *based on how you actually answered*.

---

## Agregar audio real para Listening

Por defecto usa TTS del navegador. Para usar archivos de audio propios:

1. Colocar los `.mp3` en `public/audio/`
2. En `exam-data.json`, cambiar `"audioMode": "tts"` por `"audioMode": "file"` y añadir la ruta del archivo

---

## Pruebas

```bash
npm test
```

Monta la app en jsdom y recorre la portada de punta a punta: que se pinta, que
los dos modos están, que el panel de importar abre, que acepta un examen válido
en sus tres formatos, que rechaza lo que no lo es sin perder lo que el usuario
pegó, y que se puede volver al examen de fábrica.

También comprueba la referencia de gramática y la paleta: que ningún tono de
sección baja de 4.5:1 contra el blanco de sus letras, y que el amarillo que
marca no se confunde con ninguno de los cinco azules. Un color que ES la
identidad de algo no se revisa a ojo.

Y comprueba la calificación (`test/calificacion.test.mjs`): que la llave de
Groq no aparece ni en `src/` ni en el paquete construido, que lo que devuelve
el modelo se saca de un número antes de entrar en la nota, y que sin nota la
sección se declara no calificada en vez de rellenarse sola.

---

## Stack

- **Vite 5** + **Vanilla JavaScript** (ES Modules)
- **Zod** - validación del schema del JSON
- **Web Speech API** - TTS para listening + STT para speaking
- **localStorage** - autosave del progreso
- Sin frameworks, sin dependencias externas en runtime

---

## Estructura

```
itep-b1-simulator/
├── index.html         ← SEO, JSON-LD y la portada estática para rastreadores
├── api/               ← funciones de servidor: aquí y solo aquí vive la llave
│   ├── _nucleo.js     ← el trato con Groq: transcribir y evaluar
│   ├── _http.js       ← leer el cuerpo, responder, traducir el código a HTTP
│   ├── transcribir.js ← POST audio  → texto
│   ├── evaluar.js     ← POST texto  → nota CEFR
│   └── estado.js      ← GET: ¿este despliegue califica?
├── src/
│   ├── main.js        ← motor del examen completo y la portada
│   ├── portada.css    ← la portada, con la piel del examen
│   └── styles.css     ← UI estilo académico iTEP, dentro del examen
├── scripts/
│   └── generar-og.mjs ← dibuja public/og.png con los minutos del examen
├── test/
│   ├── landing.test.mjs
│   └── calificacion.test.mjs
└── public/
    ├── data/exam-data.json  ← banco de preguntas (editable)
    ├── og.png         ← la tarjeta de WhatsApp y LinkedIn, generada
    ├── robots.txt
    ├── sitemap.xml
    ├── llms.txt       ← qué es el sitio, en prosa, para buscadores con IA
    ├── logo.svg
    └── favicon.svg
```

La portada tiene su propia hoja de estilos, pero ya no su propio lenguaje: lleva
el mismo campo azul, las mismas tarjetas claras y las mismas pastillas que el
examen, porque antes eran dos sitios distintos y se notaba al pulsar Start. Todo
cuelga de `body.en-portada`, así que no se filtra al examen, que mantiene su
escala de kiosco.

Los archivos de `api/` que empiezan por guion bajo son módulos, no endpoints:
Vercel no los publica como rutas.

---

## SEO

La app se pinta con JavaScript, así que un rastreador que no renderiza no vería
nada. Por eso `index.html` lleva tres cosas que no dependen del bundle:

- **Portada estática dentro de `#app`** - dice lo mismo que la portada real y la
  app la reemplaza al montar. Es también lo que se ve mientras carga el módulo.
- **`@graph` en JSON-LD** - `WebSite`, `WebApplication`, `LearningResource` y
  `FAQPage`, todos citando la entidad `https://kgstudio.top/#kevin` por su `@id`.
  Esa referencia cruzada es lo que une este subdominio con el resto de la zona.
- **`llms.txt`** - lo mismo en prosa, para los buscadores con IA que lo leen
  antes que el HTML. Si cambias un dato, cámbialo en los dos.

La tarjeta que se comparte, `public/og.png`, no se dibuja a mano:

```bash
npm run og
```

Saca los minutos de `public/data/exam-data.json`. La versión hecha a mano decía
"Listening 20 min" y "Speaking 5 min" cuando el examen dice 6 y 4, y esa era la
primera cifra que veía un estudiante al recibir el enlace. Si cambian los
tiempos del examen, se vuelve a correr y se actualiza `lastmod` del sitemap.

---

Desarrollado por **Kevin Gonzalez** ([kagonzalezdev](https://kgstudio.top/)).  
Basado en el formato real del examen iTEP Academic.