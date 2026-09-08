/*
 * POST /api/transcribir
 *
 * Entra el .webm que grabó el navegador, tal cual, en el cuerpo.
 * Sale `{ ok: true, texto }`.
 *
 * El audio va como cuerpo crudo y no como multipart porque el navegador solo
 * manda un archivo y aquí no hay que parsear nada: el multipart se arma en
 * `_nucleo.js` al hablar con Groq.
 */

import { transcribir } from "./_nucleo.js";
import { cuerpoCrudo, responder, estadoDeCodigo } from "./_http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return responder(res, 405, { ok: false, mensaje: "Usa POST." });

  const audio = await cuerpoCrudo(req);
  const tipo = req.headers["content-type"] || "audio/webm";
  const r = await transcribir(audio, tipo);

  return responder(res, r.ok ? 200 : estadoDeCodigo(r.codigo), r);
}
