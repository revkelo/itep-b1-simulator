/*
 * Lo poco que comparten los tres endpoints. Vive aparte para que `_nucleo.js`
 * no sepa nada de peticiones ni de respuestas y se pueda probar solo.
 *
 * El guion bajo del nombre no es decorativo: Vercel no publica como ruta los
 * archivos de `api/` que empiezan por `_`, así que estos dos son módulos y no
 * endpoints.
 */

/** Lee el cuerpo crudo. Vercel a veces ya lo entrega parseado y a veces no. */
export async function cuerpoCrudo(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return Buffer.concat(trozos);
}

export async function cuerpoJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const crudo = await cuerpoCrudo(req);
  if (!crudo.length) return {};
  try {
    return JSON.parse(crudo.toString("utf8"));
  } catch {
    return null;
  }
}

export function responder(res, estado, datos) {
  res.statusCode = estado;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  /* Nada de esto se cachea: es una respuesta por intento. */
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(datos));
}

/**
 * Traduce el `codigo` de `_nucleo.js` a un estado HTTP.
 *
 * `sin_llave` sale como 503 y no como 500 a propósito: no está roto, es que
 * este despliegue no tiene evaluación. El cliente lo distingue para decirlo
 * con esas palabras en vez de enseñar un error.
 */
export function estadoDeCodigo(codigo) {
  if (codigo === "sin_llave") return 503;
  if (codigo === "vacio" || codigo === "tipo" || codigo === "sin_voz") return 400;
  return 502;
}
