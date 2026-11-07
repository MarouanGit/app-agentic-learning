// POST /api/ask : réponse citée ou refus motivé (contrat dans README.md).
import { journal, json, protege } from "../src/http.js";
import { rediger, vecteurs } from "../src/modeles/modeles.js";
import { validerDemande } from "../src/moteur/priseEnCharge.js";
import { repondre } from "../src/moteur/repondre.js";

const MAX_OCTETS = 32 * 1024;

export async function POST(req: Request): Promise<Response> {
  return protege(req, MAX_OCTETS, "ask", async (corps) => {
    const demande = validerDemande(corps);
    const r = await repondre(demande, { vecteurs, rediger });
    journal({ route: "ask", status: 200, mode: demande.mode, statut: r.statut, porte: r.refus?.porte ?? null, citations: r.citations.length, modele: r.trace.modele, ms: r.trace.ms });
    return json(200, r);
  });
}
