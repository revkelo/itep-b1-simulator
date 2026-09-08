/*
 * El trato con Groq, en un solo sitio.
 *
 * Esto vive en el servidor y no en el navegador por una razón concreta: Vite
 * mete TODA variable que empiece por `VITE_` dentro del paquete que descarga
 * el visitante. El código anterior leía `import.meta.env.VITE_GROQ_API_KEY`,
 * así que el día que alguien la pusiera en Vercel para "hacer que funcione",
 * la llave de Groq quedaría publicada en un archivo .js de un sitio estático
 * abierto. No pasó porque la variable nunca se puso -y por eso speaking
 * llevaba tiempo sin evaluar nada-, pero la trampa estaba armada.
 *
 * Aquí la llave se queda en `process.env.GROQ_API_KEY`, igual que en parla,
 * y el navegador solo habla con /api.
 *
 * Las dos funciones se exportan sueltas, sin nada de Vercel encima, para que
 * las pueda llamar igual el adaptador de Vercel, el del servidor de Vite en
 * desarrollo y una prueba desde node.
 */

/* El mismo motor que usa parla. `GROQ_MODEL` lo puede cambiar sin tocar código. */
export const MODELO_EVALUACION = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

/* Turbo basta y sobra para inglés leído en voz alta, y es el más barato. */
export const MODELO_TRANSCRIPCION =
  process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo";

const RAIZ = "https://api.groq.com/openai/v1";

export function hayLlave() {
  return Boolean((process.env.GROQ_API_KEY || "").trim());
}

function llave() {
  return (process.env.GROQ_API_KEY || "").trim();
}

/*
 * Un fallo de Groq no puede tumbar el examen: quien está haciéndolo ya gastó
 * su hora. Todo lo que sale de aquí es `{ ok, ... }` y quien llama decide.
 */
function fallo(mensaje, codigo = "error") {
  return { ok: false, codigo, mensaje };
}

/**
 * Pasa el audio grabado a texto.
 *
 * @param {Buffer|Uint8Array} audio  el .webm que grabó el navegador
 * @param {string} tipoMime          lo que dijo el MediaRecorder
 */
export async function transcribir(audio, tipoMime = "audio/webm") {
  if (!hayLlave()) return fallo("This deployment has no AI scoring configured.", "sin_llave");
  if (!audio || audio.length === 0) return fallo("The recording arrived empty.", "vacio");

  const form = new FormData();
  form.append("file", new Blob([audio], { type: tipoMime }), "respuesta.webm");
  form.append("model", MODELO_TRANSCRIPCION);
  form.append("language", "en");
  /*
   * `text` en vez de `verbose_json`: de la respuesta solo se usa el texto, y
   * pedir los tramos con marcas de tiempo multiplica el tamaño para nada.
   */
  form.append("response_format", "text");

  let res;
  try {
    res = await fetch(`${RAIZ}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${llave()}` },
      body: form
    });
  } catch (e) {
    return fallo("Could not reach Groq: " + String(e.message), "red");
  }

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    return fallo(`Groq returned ${res.status}. ${detalle.slice(0, 200)}`, "groq");
  }

  const texto = (await res.text()).trim();
  if (!texto) return fallo("Groq found no speech in the recording.", "sin_voz");
  return { ok: true, texto };
}

/*
 * La rúbrica.
 *
 * Ojo con lo que NO se pide: la versión anterior le pedía al modelo una nota
 * de `pronunciation`, y el modelo solo ve un texto. Una nota de pronunciación
 * sacada de una transcripción está inventada de principio a fin, y encima
 * salía impresa en el informe junto a las que sí se miden. Speaking se juzga
 * por lo que se puede juzgar leyendo: qué tan bien responde a la consigna, si
 * se organiza, y qué gramática y vocabulario usa.
 */
const RUBRICA = {
  speaking: {
    claves: "score, cefr, fluency, grammar, vocabulary, coherence, feedback",
    instruccion: [
      "You are an iTEP examiner scoring the Speaking section.",
      "You are reading an automatic transcript of a spoken answer, so ignore",
      "spelling and punctuation, and never judge pronunciation or accent: you",
      "cannot hear the recording. Judge how well the answer addresses the",
      "prompt, how it is organised, and the grammar and vocabulary in it.",
      "A transcript that is empty, off-topic or a couple of words is a low",
      "score, not an average one."
    ].join(" ")
  },
  writing: {
    claves:
      "score, cefr, grammar, coherence, vocabulary, corrections, feedback, improvedVersion",
    instruccion: [
      "You are an iTEP examiner scoring the Writing section.",
      "Judge task achievement, organisation, grammar and vocabulary.",
      "`corrections` is a short list of the actual mistakes in the text, and",
      "`improvedVersion` is the same answer rewritten well, keeping the",
      "writer's own ideas. A text that is empty or off-topic is a low score."
    ].join(" ")
  }
};

/**
 * Pone una respuesta abierta en la escala CEFR.
 *
 * @param {"speaking"|"writing"} tipo
 * @param {string} consigna  el enunciado que le tocó
 * @param {string} texto     la transcripción, o lo que escribió
 * @param {string} notas     lo que apuntó durante la preparación, si apuntó
 */
export async function evaluar(tipo, consigna, texto, notas = "") {
  if (!hayLlave()) return fallo("This deployment has no AI scoring configured.", "sin_llave");
  const r = RUBRICA[tipo];
  if (!r) return fallo(`Do not know how to score "${tipo}".`, "tipo");

  const limpio = (texto || "").trim();
  if (!limpio) return fallo("There is nothing to score.", "vacio");

  const cuerpo = {
    model: MODELO_EVALUACION,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `${r.instruccion} Answer with a JSON object and nothing else, with the keys: ${r.claves}. ` +
          "`score` is 0-100 and `cefr` is one of A1, A2, B1, B2, C1, C2, and the two have to agree " +
          "(under 25 is A1, under 40 A2, under 55 B1, under 70 B2, under 85 C1, else C2). " +
          "The other marks are 0-100 too. `feedback` is two or three sentences addressed to the " +
          "candidate, in English, saying the one thing worth fixing first."
      },
      {
        role: "user",
        content:
          `Prompt: ${consigna}\n\n` +
          `Candidate response: ${limpio}` +
          (notas.trim() ? `\n\nPreparation notes the candidate wrote: ${notas.trim()}` : "")
      }
    ]
  };

  let res;
  try {
    res = await fetch(`${RAIZ}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llave()}`
      },
      body: JSON.stringify(cuerpo)
    });
  } catch (e) {
    return fallo("Could not reach Groq: " + String(e.message), "red");
  }

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    return fallo(`Groq returned ${res.status}. ${detalle.slice(0, 200)}`, "groq");
  }

  const data = await res.json().catch(() => null);
  const crudo = data?.choices?.[0]?.message?.content || "";
  let juicio;
  try {
    juicio = JSON.parse(crudo);
  } catch {
    return fallo("Groq did not return JSON.", "formato");
  }

  /*
   * Se sanea aquí y no en el navegador: `score` entra en la nota final, y un
   * `"85 out of 100"` o un `null` se convertiría en NaN a mitad de la suma.
   */
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined;
  };
  const NIVELES = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const puntaje = num(juicio.score);
  if (puntaje === undefined) return fallo("Groq did not return a usable score.", "formato");

  const nivel = String(juicio.cefr || "").toUpperCase().trim();
  const salida = {
    score: puntaje,
    cefr: NIVELES.includes(nivel)
      ? nivel
      : NIVELES[Math.min(5, Math.floor(puntaje / 100 * 6))],
    feedback: typeof juicio.feedback === "string" ? juicio.feedback : ""
  };
  for (const k of ["fluency", "grammar", "vocabulary", "coherence"]) {
    const v = num(juicio[k]);
    if (v !== undefined) salida[k] = v;
  }
  if (typeof juicio.improvedVersion === "string") salida.improvedVersion = juicio.improvedVersion;
  if (juicio.corrections !== undefined) {
    salida.corrections = Array.isArray(juicio.corrections)
      ? juicio.corrections.join(" · ")
      : String(juicio.corrections);
  }

  return { ok: true, juicio: salida };
}
