// Tri sémantique des candidats fusionnés : similarité dense (e5), rang RRF, couverture lexicale de la question et
// proximité dans le graphe (concept → leçon en 1 ou 2 sauts), puis diversité (deux passages au plus par leçon).
import type { Index } from "../index/charger.js";
import { DRAPEAU } from "../index/types.js";
import type { Candidat } from "./ancrage.js";
import { appui, type Ponderation } from "./appui.js";

export type Classe = Candidat & { score: number; couverture: number; couverturePhrase: number; phrase: string; distance: number; retire: boolean; solutionProche: boolean };

export const POIDS = { cos: 0.4, rrf: 0.2, couverture: 0.25, graphe: 0.15 };
const COS_BAS = 0.75; // e5-small : cosinus de passages sans rapport ≈ 0,75 ; très proches ≈ 0,9
const COS_HAUT = 0.92;

export function classer(ix: Index, candidats: Candidat[], pond: Ponderation, distances: Map<number, number>, max = 40): Classe[] {
  const top = candidats.slice(0, max);
  const rrfMax = Math.max(1e-9, ...top.map((c) => c.rrf));
  return top
    .map((c) => {
      const a = appui(ix, pond, c.p);
      const ps = ix.passages[c.p];
      const d = distances.get(ps.l) ?? 0;
      const cosN = Math.min(1, Math.max(0, (c.cos - COS_BAS) / (COS_HAUT - COS_BAS)));
      const g = d === 1 ? 1 : d === 2 ? 0.5 : 0;
      const score = POIDS.cos * cosN + POIDS.rrf * (c.rrf / rrfMax) + POIDS.couverture * (0.6 * a.couverturePassage + 0.4 * a.couverturePhrase) + POIDS.graphe * g;
      return { ...c, score, couverture: a.couverturePassage, couverturePhrase: a.couverturePhrase, phrase: a.phrase, distance: d, retire: (ps.f & DRAPEAU.retire) !== 0, solutionProche: (ps.f & DRAPEAU.solutionProche) !== 0 };
    })
    .sort((a, b) => b.score - a.score || a.p - b.p);
}

/** Les k passages retenus pour la rédaction : non retirés, deux au plus par leçon, sans code proche d'une solution en mode indice. */
export function retenir(ix: Index, classes: Classe[], k: number, indice: boolean): Classe[] {
  const parLecon = new Map<number, number>();
  const out: Classe[] = [];
  for (const c of classes) {
    if (c.retire || (indice && c.solutionProche)) continue;
    const l = ix.passages[c.p].l;
    if ((parLecon.get(l) ?? 0) >= 2) continue;
    parLecon.set(l, (parLecon.get(l) ?? 0) + 1);
    out.push(c);
    if (out.length === k) break;
  }
  return out;
}
