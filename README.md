# iTEP B1 Exam Simulator

Simulador completo del examen **iTEP B1** construido en Vite + Vanilla JS. Recrea la experiencia real del examen con las 5 secciones, timers por sección, autosave y reporte de nivel CEFR al final.

> Útil para estudiantes que necesitan certificar su nivel de inglés B1 con el iTEP Academic o iTEP SLATE y quieren practicar antes del examen real.

---

## ¿Qué es el iTEP?

El **iTEP (International Test of English Proficiency)** es un examen de certificación de inglés reconocido internacionalmente, ampliamente usado por universidades latinoamericanas (incluida la Universidad El Bosque) como requisito de grado. El nivel **B1** corresponde al nivel intermedio del marco CEFR.

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
- **Reporte CEFR estimado** — calcula tu nivel (A1 → C2) al terminar
- **Listening con TTS** — audio generado por el navegador, sin archivos externos
- **Speaking recorder** — graba tu respuesta con el micrófono, transcribe con Web Speech API
- **Evaluación de Writing y Speaking** — feedback automático
- **Anti-refresh warning** — aviso si intentas salir durante el examen
- **Notas por sección** — apuntes durante listening y speaking

---

## Demo rápida

```bash
git clone https://github.com/revkelo/ITEP-EXAM.git
cd ITEP-EXAM
npm install
npm run dev
```

Abre `http://localhost:5173` en el navegador.

---

## Deploy en Netlify (gratis)

1. Hacer fork de este repositorio
2. Conectar a [Netlify](https://netlify.com)
3. Build command: `npm run build` · Publish: `dist`

O usar el botón de deploy directo:

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/revkelo/ITEP-EXAM)

---

## Personalizar el banco de preguntas

Todas las preguntas están en un solo archivo JSON:

```
public/data/exam-data.json
```

Contiene las secciones `grammar`, `listening`, `reading`, `writing` y `speaking` con sus pesos, tiempos, explicaciones y metadata. Puedes editarlo para agregar o modificar preguntas sin tocar el código.

---

## Agregar audio real para Listening

Por defecto usa TTS del navegador. Para usar archivos de audio propios:

1. Colocar los `.mp3` en `public/audio/`
2. En `exam-data.json`, cambiar `"audioMode": "tts"` por `"audioMode": "file"` y añadir la ruta del archivo

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
ITEP-EXAM/
├── index.html
├── src/
│   ├── main.js        ← motor del examen completo
│   └── styles.css     ← UI estilo académico iTEP
├── public/
│   └── data/
│       └── exam-data.json  ← banco de preguntas (editable)
└── netlify.toml
```

---

Desarrollado por **Kevin Gonzalez**  
Basado en el formato real del examen iTEP B1 Academic.