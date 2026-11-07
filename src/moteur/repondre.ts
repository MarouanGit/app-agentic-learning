// Orchestration de POST /api/ask : prise en charge → ancrage hybride → concepts et chemins CSR → tri sémantique →
// portes 1 à 5 (en parallèle) → rédaction (Qwen) → validation des citations → porte 6 (vérification) → réponse ou refus.
import { chargerIndex, type Index } from "../index/charger.js";
import { nomModele, REDACTION } from "../modeles/catalogue.js";
import { couper, phrases } from "../texte/phrases.js";
import { nombreDeMots } from "../texte/normaliser.js";
import { ancrer } from "./ancrage.js";
import { couverture, decoupePassage, ponderer, type Ponderation } from "./appui.js";
import { sansCitations, validerCitations } from "./citations.js";
import { leconsAtteintes, lierConcepts } from "./concepts.js";
import { evaluerPortes, PORTES, premiereFermee, type ResultatPorte } from "./portes.js";
import { prendreEnCharge, type Demande, type Requete } from "./priseEnCharge.js";
import { borner, messages, nettoyer, neSaitPas, retirerCode } from "./redaction.js";
import { classer, retenir, type Classe } from "./tri.js";
import { verifier } from "./verification.js";

export type Citation = { n: number; cours: string; coursTitre: string; lecon: string; titre: string; extrait: string; url: string };
export type ReponseAsk = {
  statut: "reponse" | "refus";
  texte: string;
  citations: Citation[];
  refus?: { porte: number; code: string; message: string };
  trace: { portes: ResultatPorte[]; modele: string; ms: number };
};

export type Moteurs = {
  vecteurs: (textes: string[], prefixe: "query: " | "passage: ") => Promise<Float32Array[]>;
  rediger: (m: { role: "system" | "user" | "assistant"; content: string }[], o: { maxJetons: number; echeance: number; fini?: (t: string) => boolean }) => Promise<{ texte: string; delaiDepasse: boolean }>;
};

export const K_PASSAGES = 4;
const ECHEANCE_REDACTION_MS = Number(process.env.AGENTIC_ECHEANCE_REDACTION_MS ?? 60_000);

/** Cours où citer une leçon : le cours en cours s'il la contient, sinon le premier cours autorisé qui la contient. */
function placement(ix: Index, r: Requete, li: number): number {
  const cs = ix.coursDeLecon[li];
  if (r.coursIdx >= 0 && cs.includes(r.coursIdx)) return r.coursIdx;
  return cs.find((c) => r.autorises[c]) ?? cs[0] ?? 0;
}

function citer(ix: Index, r: Requete, c: Classe, n: number, extrait?: string): Citation {
  const ps = ix.passages[c.p];
  const lecon = ix.ontologie.lecons[ps.l];
  const cours = ix.ontologie.cours[placement(ix, r, ps.l)];
  return { n, cours: cours.slug, coursTitre: cours.titre, lecon: lecon.slug, titre: lecon.titre, extrait: couper(extrait ?? c.phrase, 280), url: `/cours/${cours.slug}/${lecon.slug}` };
}

function refus(n: number, portes: ResultatPorte[], t0: number, modele = "aucun"): ReponseAsk {
  const p = PORTES[n - 1];
  return { statut: "refus", texte: p.message, citations: [], refus: { porte: p.n, code: p.code, message: p.message }, trace: { portes, modele, ms: Math.round(performance.now() - t0) } };
}

// Une phrase qui commence par un connecteur ou un pronom dépend de la précédente : mauvais extrait isolé.
const ANAPHORE = /^(mais|donc|ici|cela|ça|ca|alors|et|ensuite|puis|sinon|enfin|or|ce|cet|cette|ces|il|elle|ils|elles|on y|là)\b/i;

/** Réponse extractive : pour chaque passage retenu, sa meilleure phrase autonome ; 3 phrases et 110 mots au plus. */
function extractive(ix: Index, pond: Ponderation, retenus: Classe[], indice: boolean): { texte: string; utilises: number[]; extraits: string[] } | null {
  const choix: { i: number; ph: string; note: number }[] = [];
  for (const [i, c] of retenus.entries()) {
    let best: { ph: string; note: number } | null = null;
    for (const ph of decoupePassage(ix, c.p).phrases) {
      const t = ph.texte.replace(/^[•\-\s]+/, "").trim();
      if (nombreDeMots(t) < 7 || /\?\s*$/.test(t) || /^Objectifs :/.test(t)) continue;
      if (indice && /[=();{}]|^\s*(SELECT|import|def)\b/i.test(t)) continue;
      const note = couverture(pond, ph.termes) - (ANAPHORE.test(t) ? 0.25 : 0);
      if (note >= 0.4 && (!best || note > best.note)) best = { ph: t, note };
    }
    if (best) choix.push({ i, ...best });
  }
  const lignes: string[] = [];
  const utilises: number[] = [];
  let mots = 0;
  for (const { i, ph } of choix) {
    if (lignes.some((l) => l.startsWith(ph.slice(0, 40)))) continue;
    if (mots + nombreDeMots(ph) > 110 || lignes.length === 3) break;
    utilises.push(i);
    lignes.push(`${ph.replace(/[\s.!?…:]*$/, "")} [${utilises.length}].`);
    mots += nombreDeMots(ph);
  }
  if (!lignes.length) return null;
  return { texte: (indice ? "Piste tirée du cours : " : "D'après le cours : ") + lignes.join(" "), utilises, extraits: utilises.map((i) => choix.find((c) => c.i === i)!.ph) };
}

export async function repondre(d: Demande, moteurs: Moteurs): Promise<ReponseAsk> {
  const t0 = performance.now();
  const ix = chargerIndex();
  const r = prendreEnCharge(d, ix);
  const indice = r.mode === "indice";

  // Ancrage hybride (agents lexical et dense en parallèle), concepts, chemins CSR, tri sémantique.
  const ancrage = await ancrer(ix, r, async () => (/[\p{L}\p{N}]/u.test(r.question) ? (await moteurs.vecteurs([r.texteDense], "query: "))[0] : null));
  const lies = lierConcepts(ix, r);
  const { distances } = leconsAtteintes(ix, lies);
  const pond = ponderer(ix, r);
  const classes = classer(ix, ancrage.candidats, pond, distances);

  // Portes 1 à 5, en parallèle.
  const portes = await evaluerPortes({ ix, r, ancrage, lies, classes });
  const fermee = premiereFermee(portes);
  if (fermee) return refus(fermee.n, portes, t0);
  const retenus = retenir(ix, classes, K_PASSAGES, indice);
  if (!retenus.length) return refus(4, portes, t0);

  // Rédaction sous consigne stricte.
  const modele = nomModele(REDACTION);
  let brut = "";
  try {
    const g = await moteurs.rediger(messages(ix, r.mode, r.question, r.code, retenus), {
      maxJetons: 170,
      echeance: Date.now() + ECHEANCE_REDACTION_MS,
      fini: (t) => nombreDeMots(t) > 125 && /[.!?\]]\s*$/.test(t),
    });
    brut = g.texte;
  } catch {
    brut = "";
  }
  let texte = nettoyer(brut);
  if (indice) texte = retirerCode(texte, ix.empreintes);
  texte = borner(texte);

  // Validation des citations, puis porte 6 : chaque phrase doit être appuyée par un passage fourni.
  const v = validerCitations(texte, retenus.length);
  const cites = v.ordre.map((n) => retenus[n - 1]);
  // Passages numérotés comme dans le texte validé, puis les autres retenus (pour corriger une citation mal placée).
  const pool = [...cites, ...retenus.filter((c) => !cites.includes(c))];
  const t6 = performance.now();
  const verif = v.texte && !neSaitPas(v.texte) ? await verifier(ix, v.texte, pool.map((c) => c.p), (t) => moteurs.vecteurs(t, "query: ")) : null;
  // Réponse rédigée partiellement vérifiée : si au moins la moitié des phrases (et au moins une) sont appuyées, on ne
  // garde QUE celles-là ; chaque phrase rendue reste ainsi vérifiée. Sinon : réponse extractive, puis refus.
  if (verif && !verif.ok) {
    const pleines = verif.phrases.filter((p) => !p.neutre);
    const bonnes = pleines.filter((p) => p.ok);
    if (bonnes.length >= 1 && bonnes.length * 2 >= pleines.length) {
      const garde = await verifier(ix, bonnes.map((p) => p.texte).join(" "), pool.map((c) => c.p), (t) => moteurs.vecteurs(t, "query: "));
      if (garde.ok) Object.assign(verif, garde);
    }
  }
  const ok6 = !!verif?.ok;
  const porte6: ResultatPorte = { n: 6, nom: PORTES[5].nom, ok: ok6, ms: 0 };
  const trace = [...portes, porte6];

  if (ok6 && verif) {
    // Renumérotation finale : seuls les passages réellement cités, dans l'ordre d'apparition.
    const finale = validerCitations(verif.texte, pool.length);
    const extraits = new Map<number, string>();
    for (const ph of verif.phrases) if (!ph.neutre && ph.ok && !extraits.has(ph.appui)) extraits.set(ph.appui, bestPhrase(ix, pool[ph.appui - 1], sansCitations(ph.texte)));
    const citations = finale.ordre.map((n, i) => citer(ix, r, pool[n - 1], i + 1, extraits.get(n)));
    porte6.ms = Number((performance.now() - t6).toFixed(2));
    if (citations.length) return { statut: "reponse", texte: finale.texte, citations, trace: { portes: trace, modele, ms: Math.round(performance.now() - t0) } };
  }
  // Échec de la vérification : réponse extractive (phrases du cours, citées), sinon refus.
  const ex = extractive(ix, pond, retenus, indice);
  porte6.ms = Number((performance.now() - t6).toFixed(2));
  if (!ex) return refus(6, trace, t0, modele);
  return {
    statut: "reponse",
    texte: ex.texte,
    citations: ex.utilises.map((i, k) => citer(ix, r, retenus[i], k + 1, ex.extraits[k])),
    trace: { portes: trace, modele: "extractif", ms: Math.round(performance.now() - t0) },
  };
}

/** Extrait d'une citation : la phrase du passage la plus proche de la phrase rédigée qu'elle appuie. */
function bestPhrase(ix: Index, c: Classe, redigee: string): string {
  const mots = new Set(redigee.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((m) => m.length > 3));
  let best = c.phrase;
  let score = -1;
  for (const p of phrases(ix.passages[c.p].t)) {
    const s = p.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((m) => mots.has(m)).length;
    if (s > score) ((score = s), (best = p));
  }
  return best;
}
