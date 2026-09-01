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

- **5 secciones completas** — Grammar · Listening · Reading · Writing · Speaking
- **Timers reales** por sección — igual que el examen oficial
- **Modo examen** y **modo estudio**
- **Autosave local** — si cierras el navegador, retoma donde dejaste
- **Revisión antes de enviar** — revisa respuestas antes del submit final
- **Reporte CEFR estimado** — calcula tu nivel (A1 → C2) al terminar, más el nivel iTEP equivalente
- **Listening con TTS** — audio generado por el navegador, sin archivos externos
- **Speaking recorder** — graba tu respuesta con el micrófono, transcribe con Web Speech API
- **Evaluación de Writing y Speaking** — feedback automático
- **Anti-refresh warning** — aviso si intentas salir durante el examen
- **Notas por sección** — apuntes durante listening y speaking

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

Todo lo de `public/` — `robots.txt`, `sitemap.xml`, `llms.txt`, `favicon.svg` y el
banco de preguntas — se copia tal cual a la raíz del build.

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

---

## Stack

- **Vite 5** + **Vanilla JavaScript** (ES Modules)
- **Zod** — validación del schema del JSON
- **Web Speech API** — TTS para listening + STT para speaking
- **localStorage** — autosave del progreso
- Sin frameworks, sin dependencias externas en runtime

---

## Estructura

```
itep-b1-simulator/
├── index.html         ← SEO, JSON-LD y la portada estática para rastreadores
├── src/
│   ├── main.js        ← motor del examen completo
│   └── styles.css     ← UI estilo académico iTEP
└── public/
    ├── data/exam-data.json  ← banco de preguntas (editable)
    ├── robots.txt
    ├── sitemap.xml
    ├── llms.txt       ← qué es el sitio, en prosa, para buscadores con IA
    └── favicon.svg
```

---

## SEO

La app se pinta con JavaScript, así que un rastreador que no renderiza no vería
nada. Por eso `index.html` lleva tres cosas que no dependen del bundle:

- **Portada estática dentro de `#app`** — dice lo mismo que la portada real y la
  app la reemplaza al montar. Es también lo que se ve mientras carga el módulo.
- **`@graph` en JSON-LD** — `WebSite`, `WebApplication`, `LearningResource` y
  `FAQPage`, todos citando la entidad `https://kgstudio.top/#kevin` por su `@id`.
  Esa referencia cruzada es lo que une este subdominio con el resto de la zona.
- **`llms.txt`** — lo mismo en prosa, para los buscadores con IA que lo leen
  antes que el HTML. Si cambias un dato, cámbialo en los dos.

---

Desarrollado por **Kevin Gonzalez** ([kagonzalezdev](https://kgstudio.top/)).  
Basado en el formato real del examen iTEP Academic.