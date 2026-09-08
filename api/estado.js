/*
 * GET /api/estado
 *
 * Dice si este despliegue puede transcribir y evaluar, sin soltar la llave
 * ni un trozo de ella.
 *
 * Existe para no prometerle al candidato una nota que no va a llegar: la
 * pantalla de speaking lo consulta antes de grabar y avisa ahí mismo si la
 * respuesta se va a guardar sin calificar, en vez de dejarlo enterarse al
 * final, en el informe, cuando ya no puede hacer nada.
 */

import { hayLlave, MODELO_EVALUACION, MODELO_TRANSCRIPCION } from "./_nucleo.js";
import { responder } from "./_http.js";

export default async function handler(req, res) {
  return responder(res, 200, {
    ok: true,
    califica: hayLlave(),
    modelos: hayLlave()
      ? { evaluacion: MODELO_EVALUACION, transcripcion: MODELO_TRANSCRIPCION }
      : null
  });
}
