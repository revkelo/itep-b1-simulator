import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequest } from "../functions/api/[[path]].js";

const call = (path, init) => onRequest({
  request: new Request(`https://example.com/api/${path}`, init),
  params: { path: path.split("/") }
});

test("Pages conserva estado, métodos y rutas desconocidas", async () => {
  delete process.env.GROQ_API_KEY;
  const state = await call("estado");
  assert.equal(state.status, 200);
  assert.equal(state.headers.get("cache-control"), "no-store");
  assert.deepEqual(await state.json(), { ok: true, califica: false, modelos: null });
  assert.equal((await call("transcribir")).status, 405);
  assert.equal((await call("evaluar")).status, 405);
  assert.equal((await call("missing")).status, 404);
  assert.equal((await call("constructor")).status, 404);
  assert.equal((await call("nested/estado")).status, 404);
});

test("Pages conserva JSON inválido y ausencia de llave", async () => {
  assert.equal((await call("evaluar", { method: "POST", body: "{" })).status, 400);
  const evaluation = await call("evaluar", {
    method: "POST", body: JSON.stringify({ tipo: "writing", texto: "Hello." })
  });
  assert.equal(evaluation.status, 503);
  assert.equal((await evaluation.json()).codigo, "sin_llave");
});

test("Pages envía audio y devuelve la transcripción de Groq", async () => {
  const originalFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = "test-server-only";
  globalThis.fetch = async (url, init) => {
    assert.match(url, /\/audio\/transcriptions$/);
    assert.equal(init.headers.Authorization, "Bearer test-server-only");
    const file = init.body.get("file");
    assert.equal(file.type, "audio/webm");
    assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3]);
    return new Response("Test transcript");
  };
  try {
    const response = await call("transcribir", {
      method: "POST", headers: { "Content-Type": "audio/webm" },
      body: new Uint8Array([1, 2, 3])
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, texto: "Test transcript" });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
  }
});
