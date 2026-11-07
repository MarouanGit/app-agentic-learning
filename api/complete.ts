// POST /api/complete : autocomplétion de code (FIM), suggestion vide passé 4 s.
import { journal, json, protege } from "../src/http.js";
import { chargerIndex } from "../src/index/charger.js";
import { completerFIM } from "../src/modeles/modeles.js";
import { completer, validerCompletion } from "../src/moteur/completer.js";

const MAX_OCTETS = 16 * 1024;

function titreLecon(slug?: string): string | undefined {
  if (!slug) return undefined;
  try {
    const ix = chargerIndex();
    const i = ix.leconParSlug.get(slug);
    return i === undefined || ix.retiree[i] ? undefined : ix.ontologie.lecons[i].titre;
  } catch {
    return undefined; // l'index n'est pas indispensable à l'autocomplétion
  }
}

export async function POST(req: Request): Promise<Response> {
  return protege(req, MAX_OCTETS, "complete", async (corps) => {
    const d = validerCompletion(corps);
    const r = await completer(d, completerFIM, titreLecon(d.lecon));
    journal({ route: "complete", status: 200, langage: d.langage, vide: r.suggestion.length === 0, ms: r.ms });
    return json(200, r);
  });
}
