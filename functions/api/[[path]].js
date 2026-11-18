import { Buffer } from "node:buffer";
import estado from "../../api/estado.js";
import evaluar from "../../api/evaluar.js";
import transcribir from "../../api/transcribir.js";
import { conEntorno } from "../../api/_nucleo.js";

const handlers = { estado, evaluar, transcribir };

// Reutiliza las API de Vercel sin duplicar la lógica de evaluación ni exponer
// las llaves de Groq al navegador. nodejs_compat proporciona process.env.
export async function onRequest({ request, params, env }) {
  const path = Array.isArray(params.path) ? params.path.join("/") : params.path;
  const handler = Object.hasOwn(handlers, path) ? handlers[path] : null;
  if (!handler) {
    return Response.json({ ok: false, mensaje: "No such endpoint" }, { status: 404 });
  }

  const req = {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: Buffer.from(await request.arrayBuffer())
  };
  const headers = new Headers();
  let body = null;
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name, value); },
    end(value) { body = value; }
  };
  await conEntorno(env, () => handler(req, res));
  return new Response(request.method === "HEAD" ? null : body, {
    status: res.statusCode,
    headers
  });
}
