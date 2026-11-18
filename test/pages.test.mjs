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

test("Pages uses server bindings for Deepgram and Groq without exposing secrets", async () => {
  const originalFetch = globalThis.fetch;
  const env = { GROQ_API_KEY: "test-groq", DEEPGRAM_API_KEY: "test-deepgram" };
  const invoke = (path, init) => onRequest({
    request: new Request(`https://example.com/api/${path}`, init), params: { path: [path] }, env
  });
  const state = await (await invoke("estado")).json();
  assert.equal(state.califica, true);
  assert.equal(state.modelos.transcripcion, "deepgram/nova-3");
  assert.ok(!JSON.stringify(state).includes("test-groq"));
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.match(url, /^https:\/\/api.deepgram.com\/v1\/listen\?/);
    assert.equal(init.headers.Authorization, "Token test-deepgram");
    assert.deepEqual([...init.body], [1, 2, 3]);
    return Response.json({ results: { channels: [{ alternatives: [{ transcript: "My practice answer." }] }] } });
  };
  try {
    const response = await invoke("transcribir", { method: "POST", body: new Uint8Array([1, 2, 3]) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, texto: "My practice answer." });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("Deepgram provider errors fall back to Groq Whisper", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    if (String(url).includes("deepgram.com")) return new Response(null, { status: 503 });
    assert.match(url, /api.groq.com/);
    assert.equal(init.headers.Authorization, "Bearer test-groq");
    return new Response("Recovered transcript");
  };
  try {
    const response = await onRequest({
      request: new Request("https://example.com/api/transcribir", { method: "POST", body: new Uint8Array([1]) }),
      params: { path: ["transcribir"] }, env: { GROQ_API_KEY: "test-groq", DEEPGRAM_API_KEY: "test-deepgram" }
    });
    assert.equal((await response.json()).texto, "Recovered transcript");
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});
