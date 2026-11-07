// Couche HTTP commune des fonctions : secret Bearer comparé à temps constant, corps JSON borné, réponses JSON,
// journal minimal (jamais de texte d'apprenant : route, statut, porte, durée).
import { createHash, timingSafeEqual } from "node:crypto";
import { EntreeInvalide } from "./moteur/priseEnCharge.js";

const ENTETES = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

export const json = (status: number, corps: unknown) => new Response(JSON.stringify(corps), { status, headers: ENTETES });
export const erreur = (status: number, code: string, message: string) => json(status, { erreur: { code, message } });

/** Compare le jeton Bearer au secret à temps constant (empreintes SHA-256 de même longueur, quel que soit le jeton). */
export function autorise(req: Request, secret = process.env.AGENTIC_SECRET): boolean {
  if (!secret || secret.length < 32) return false; // pas de secret configuré : tout est refusé
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(h);
  const jeton = m ? m[1].trim() : "";
  const a = createHash("sha256").update(jeton).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) && jeton.length === secret.length;
}

export class CorpsTropGros extends Error {}

/** Lit un corps JSON d'au plus `max` octets (en-tête Content-Length puis flux réellement reçu). */
export async function lireJson(req: Request, max: number): Promise<unknown> {
  const annonce = Number(req.headers.get("content-length") ?? "0");
  if (annonce > max) throw new CorpsTropGros();
  if (!req.body) throw new EntreeInvalide("Corps JSON attendu.");
  const lecteur = req.body.getReader();
  const morceaux: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await lecteur.cancel().catch(() => {});
      throw new CorpsTropGros();
    }
    morceaux.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(morceaux).toString("utf8"));
  } catch {
    throw new EntreeInvalide("JSON invalide.");
  }
}

export function journal(evenement: Record<string, string | number | boolean | null>) {
  // Volontairement pauvre : ni question, ni code, ni texte produit, ni identifiant d'apprenant.
  console.log(JSON.stringify({ app: "agentic-learning", ...evenement }));
}

/** Enveloppe d'une route protégée : secret, lecture bornée, erreurs traduites en réponses JSON. */
export async function protege(req: Request, max: number, route: string, f: (corps: unknown) => Promise<Response>): Promise<Response> {
  const t0 = performance.now();
  if (!autorise(req)) {
    journal({ route, status: 401, ms: Math.round(performance.now() - t0) });
    return erreur(401, "non-autorise", "Jeton manquant ou invalide.");
  }
  try {
    const corps = await lireJson(req, max);
    return await f(corps);
  } catch (e) {
    if (e instanceof CorpsTropGros) return erreur(413, "trop-gros", `Corps limité à ${max} octets.`);
    if (e instanceof EntreeInvalide) return erreur(400, "entree-invalide", e.message);
    journal({ route, status: 500, erreur: (e as Error).name, ms: Math.round(performance.now() - t0) });
    return erreur(500, "erreur-interne", "Erreur interne du service.");
  }
}
