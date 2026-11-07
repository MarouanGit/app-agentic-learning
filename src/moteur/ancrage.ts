// Ancrage hybride : deux agents en parallèle, l'un lexical (BM25 top 50, requête élargie par synonymes et par le code),
// l'autre dense (e5, cosinus sur les vecteurs int8, top 50), fusionnés par RRF (k = 60) avec un bonus pour le cours et
// la leçon en cours. Seuls les passages des cours autorisés concourent. Cache LRU des scores par requête.
import type { Index } from "../index/charger.js";
import { DIMENSION, DRAPEAU } from "../index/types.js";
import { chercherBM25 } from "./bm25.js";
import { LRU } from "./lru.js";
import type { Requete } from "./priseEnCharge.js";

export const K_AGENT = 50;
export const K_RRF = 60;
export const BONUS_COURS = 1.15;
export const BONUS_LECON = 1.35;

export type Candidat = { p: number; rrf: number; rangL: number; rangD: number; bm25: number; cos: number };
export type Ancrage = { candidats: Candidat[]; lexicaux: number; denses: number; cosMax: number; msLexical: number; msDense: number };

/** Un passage concourt si sa leçon est placée dans un cours autorisé (ou, pour un passage retiré, si son cours l'est). */
export function admis(ix: Index, r: Requete, p: number): boolean {
  if (r.tous) return true;
  const ps = ix.passages[p];
  if (ps.f & DRAPEAU.retire && ix.ontologie.lecons[ps.l].p.length === 0) return ps.c >= 0 && r.autorises[ps.c] === 1;
  for (const c of ix.coursDeLecon[ps.l]) if (r.autorises[c]) return true;
  return false;
}

export function requeteLexicale(r: Requete) {
  return [
    ...r.termes.map((terme) => ({ terme, poids: 1 })),
    ...r.expansion.map((terme) => ({ terme, poids: 0.5 })),
    ...r.termesCode.map((terme) => ({ terme, poids: 0.6 })),
    ...r.termesContexte.map((terme) => ({ terme, poids: 0.8 })),
  ];
}

export function agentLexical(ix: Index, r: Requete) {
  return chercherBM25(ix.bm25, requeteLexicale(r), K_AGENT, (d) => admis(ix, r, d));
}

/** Cosinus de la requête avec un passage (vecteur int8 × échelle). */
export function cosinus(ix: Index, q: Float32Array, p: number): number {
  const o = p * DIMENSION;
  let s = 0;
  for (let d = 0; d < DIMENSION; d++) s += q[d] * ix.vecteurs[o + d];
  return s * ix.echelles[p];
}

export function agentDense(ix: Index, r: Requete, q: Float32Array | null): { doc: number; score: number }[] {
  if (!q || !ix.vecteurs.length) return [];
  const N = ix.passages.length;
  // Tas borné à K_AGENT (tableau trié ; K petit).
  const top: { doc: number; score: number }[] = [];
  for (let p = 0; p < N; p++) {
    const s = cosinus(ix, q, p);
    if (top.length === K_AGENT && s <= top[K_AGENT - 1].score) continue;
    if (!admis(ix, r, p)) continue;
    let i = top.length < K_AGENT ? top.length : K_AGENT - 1;
    top[i] = { doc: p, score: s };
    while (i > 0 && top[i - 1].score < top[i].score) ([top[i - 1], top[i]] = [top[i], top[i - 1]]), i--;
  }
  return top;
}

const cacheScores = new LRU<string, Ancrage>(500);
export const statsCacheScores = () => ({ taille: cacheScores.taille, succes: cacheScores.succes, echecs: cacheScores.echecs });

function cleCache(r: Requete) {
  return [r.question.toLowerCase(), r.texteDense, r.termesCode.join(","), r.coursIdx, r.leconIdx, r.tous ? "*" : Buffer.from(r.autorises).toString("base64")].join("|");
}

export async function ancrer(ix: Index, r: Requete, vecteurRequete: () => Promise<Float32Array | null>): Promise<Ancrage> {
  const cle = cleCache(r);
  const deja = cacheScores.get(cle);
  if (deja) return deja;
  const t0 = performance.now();
  // Les deux agents en parallèle (le lexical s'exécute pendant que l'encodeur calcule le vecteur de la question).
  const [lexicaux, { denses, q, msDense }] = await Promise.all([
    Promise.resolve().then(() => {
      const res = agentLexical(ix, r);
      return { res, ms: performance.now() - t0 };
    }),
    (async () => {
      const t = performance.now();
      const q = await vecteurRequete();
      const denses = agentDense(ix, r, q);
      return { denses, q, msDense: performance.now() - t };
    })(),
  ]);
  const fusion = new Map<number, Candidat>();
  const obtenir = (p: number) => {
    let c = fusion.get(p);
    if (!c) fusion.set(p, (c = { p, rrf: 0, rangL: -1, rangD: -1, bm25: 0, cos: 0 }));
    return c;
  };
  lexicaux.res.forEach((x, i) => {
    const c = obtenir(x.doc);
    c.rangL = i;
    c.bm25 = x.score;
    c.rrf += 1 / (K_RRF + i + 1);
  });
  denses.forEach((x, i) => {
    const c = obtenir(x.doc);
    c.rangD = i;
    c.rrf += 1 / (K_RRF + i + 1);
  });
  let cosMax = 0;
  for (const c of fusion.values()) {
    c.cos = q ? cosinus(ix, q, c.p) : 0;
    cosMax = Math.max(cosMax, c.cos);
    const l = ix.passages[c.p].l;
    if (r.leconIdx === l) c.rrf *= BONUS_LECON;
    else if (r.coursIdx >= 0 && ix.coursDeLecon[l].includes(r.coursIdx)) c.rrf *= BONUS_COURS;
  }
  const candidats = [...fusion.values()].sort((a, b) => b.rrf - a.rrf || a.p - b.p);
  const res: Ancrage = { candidats, lexicaux: lexicaux.res.length, denses: denses.length, cosMax, msLexical: lexicaux.ms, msDense };
  cacheScores.set(cle, res);
  return res;
}
