/*
 * POST /api/evaluar
 *
 * Entra `{ tipo, consigna, texto, notas }`.
 * Sale `{ ok: true, juicio: { score, cefr, ... } }`.
 *
 * El `score` ya viene acotado a 0-100 y coherente con el `cefr` desde
 * `_nucleo.js`: entra en la nota final, y ahí un NaN no se nota hasta el
 * informe.
 */

import { evaluar } from "./_nucleo.js";
import { cuerpoJson, responder, estadoDeCodigo } from "./_http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return responder(res, 405, { ok: false, mensaje: "Usa POST." });

  const cuerpo = await cuerpoJson(req);
  if (!cuerpo) return responder(res, 400, { ok: false, mensaje: "El cuerpo no es JSON." });

  const r = await evaluar(
    cuerpo.tipo,
    String(cuerpo.consigna || ""),
    String(cuerpo.texto || ""),
    String(cuerpo.notas || "")
  );

  return responder(res, r.ok ? 200 : estadoDeCodigo(r.codigo), r);
}
