# iTEP B1 Simulator (Vite + Vanilla)

Aplicación reconstruida desde cero en HTML/CSS/JS vanilla.

## Ejecutar
```bash
npm install
npm run dev
```
Abre `http://localhost:3000`.

## JSON unico (todas las preguntas y secciones)
- `public/data/exam-data.json`

Ese archivo contiene:
- grammar
- reading
- listening
- writing
- speaking
- pesos, tiempos, explicaciones y metadata.

## Archivos principales
- `src/main.js` (motor de examen)
- `src/styles.css` (UI estilo academico iTEP)

## Notas Listening
- Usa `audioMode: "tts"` para voz TTS del navegador (sin 404 de mp3).
- Si quieres mp3 local, cambia a `audioMode: "file"` y coloca el archivo en `public/audio/...`.

## Funciones incluidas
- modo examen por secciones
- timer por seccion
- progreso
- seleccion visual de respuestas
- autosave local
- review antes de submit
- reporte final con CEFR estimado
- anti-refresh warning
- speaking recorder + transcript (si navegador lo soporta)