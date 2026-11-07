// GET /api/sante : état du service, sans aucun contenu (ni texte de leçon, ni titre). Seule route sans secret.
// Ne lit que le manifeste de l'index (comptes, date) : réponse rapide, même à froid.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { json } from "../src/http.js";
import { dossierIndex } from "../src/index/charger.js";
import type { Manifeste } from "../src/index/types.js";
import { MODELES, nomModele } from "../src/modeles/catalogue.js";

export async function GET(): Promise<Response> {
  const modeles = MODELES.map((m) => ({ role: m.role, nom: nomModele(m) }));
  try {
    const m = JSON.parse(readFileSync(join(dossierIndex(), "manifeste.json"), "utf8")) as Manifeste;
    return json(200, {
      ok: true,
      index: { lecons: m.comptes.lecons, passages: m.comptes.passages, concepts: m.comptes.concepts, aretes: m.comptes.aretes, construitLe: m.construitLe },
      modeles,
    });
  } catch {
    return json(503, { ok: false, index: null, modeles });
  }
}
