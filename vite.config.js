import { defineConfig, loadEnv } from "vite";

/*
 * En Vercel, los archivos de `api/` se publican solos como funciones. El
 * servidor de Vite no sabe nada de eso, así que en desarrollo `/api/...`
 * devolvía el index.html y speaking se comportaba distinto en local que en
 * producción -que es la peor forma de que se comporte-.
 *
 * Este complemento monta los mismos archivos como middleware. No hay una
 * segunda copia de la lógica: importa `api/*.js` tal cual, y lo hace en cada
 * petición para que al guardar el archivo el cambio se note sin reiniciar.
 */
function apiEnDesarrollo() {
  return {
    name: "api-en-desarrollo",
    configureServer(servidor) {
      servidor.middlewares.use(async (req, res, siguiente) => {
        const ruta = (req.url || "").split("?")[0];
        if (!ruta.startsWith("/api/")) return siguiente();

        const nombre = ruta.slice("/api/".length).replace(/\/+$/, "");
        /* Ni subir de directorio ni alcanzar los módulos con guion bajo. */
        if (!/^[a-z][a-z0-9-]*$/.test(nombre)) {
          res.statusCode = 404;
          return res.end("No such endpoint");
        }

        try {
          const mod = await servidor.ssrLoadModule(`/api/${nombre}.js`);
          await mod.default(req, res);
        } catch (e) {
          /* En producción esto sería un 500 de Vercel; que aquí se vea igual. */
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ ok: false, mensaje: String(e.message) }));
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  /*
   * `GROQ_API_KEY` no lleva el prefijo `VITE_`, y eso es deliberado: Vite mete
   * en el paquete del navegador todo lo que empiece por `VITE_`. Sin prefijo
   * no llega nunca al cliente, pero tampoco lo carga Vite solo, así que aquí
   * se pasa a `process.env` para que las funciones de `api/` lo vean en
   * desarrollo igual que lo verían en Vercel.
   */
  const env = loadEnv(mode, process.cwd(), "");
  for (const k of ["GROQ_API_KEY", "GROQ_MODEL", "GROQ_WHISPER_MODEL"]) {
    if (env[k] && !process.env[k]) process.env[k] = env[k];
  }

  return {
    server: { port: 3000 },
    plugins: [apiEnDesarrollo()]
  };
});
