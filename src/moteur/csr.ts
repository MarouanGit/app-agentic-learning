// Graphe de l'ontologie en CSR (Compressed Sparse Row) : offsets[n]..offsets[n+1] donnent les arêtes sortantes du
// nœud n dans cibles / types / poids. Parcours en largeur borné (2 sauts au plus) avec cache LRU des chemins.
import { LRU } from "./lru.js";

export type Graphe = { offsets: Uint32Array; cibles: Uint32Array; types: Uint8Array; poids: Float32Array };
export type Arete = { de: number; vers: number; type: number; poids: number };

export function construireCSR(nbNoeuds: number, aretes: Arete[]): Graphe {
  const offsets = new Uint32Array(nbNoeuds + 1);
  for (const a of aretes) offsets[a.de + 1]++;
  for (let i = 0; i < nbNoeuds; i++) offsets[i + 1] += offsets[i];
  const curseur = offsets.slice(0, nbNoeuds);
  const cibles = new Uint32Array(aretes.length);
  const types = new Uint8Array(aretes.length);
  const poids = new Float32Array(aretes.length);
  for (const a of aretes) {
    const p = curseur[a.de]++;
    cibles[p] = a.vers;
    types[p] = a.type;
    poids[p] = a.poids;
  }
  return { offsets, cibles, types, poids };
}

export const nbAretes = (g: Graphe) => g.cibles.length;

export type Atteint = { distance: number; parent: number; type: number };

/**
 * BFS depuis des graines, `sauts` au plus, en ne suivant que les types d'arêtes `suivis`.
 * Renvoie chaque nœud atteint avec sa distance et son prédécesseur (pour reconstituer le chemin).
 */
export function bfs(g: Graphe, graines: number[], suivis: ReadonlySet<number>, sauts = 2, plafond = 50_000): Map<number, Atteint> {
  const atteints = new Map<number, Atteint>();
  let front: number[] = [];
  for (const s of graines) if (!atteints.has(s)) (atteints.set(s, { distance: 0, parent: -1, type: -1 }), front.push(s));
  for (let d = 1; d <= Math.min(sauts, 2) && front.length; d++) {
    const suivant: number[] = [];
    for (const n of front)
      for (let p = g.offsets[n]; p < g.offsets[n + 1]; p++) {
        if (!suivis.has(g.types[p])) continue;
        const v = g.cibles[p];
        if (atteints.has(v)) continue;
        atteints.set(v, { distance: d, parent: n, type: g.types[p] });
        suivant.push(v);
        if (atteints.size >= plafond) return atteints;
      }
    front = suivant;
  }
  return atteints;
}

/** Chemin (liste de nœuds) de la graine jusqu'à `cible`, d'après le résultat d'un BFS. */
export function chemin(atteints: Map<number, Atteint>, cible: number): number[] {
  const out: number[] = [];
  let n = cible;
  while (n !== -1 && out.length < 4) {
    out.unshift(n);
    n = atteints.get(n)?.parent ?? -1;
  }
  return out;
}

/** BFS mis en cache : la clé est l'ensemble trié des graines (les chemins ne dépendent que d'elles). */
export class Chemins {
  readonly cache: LRU<string, Map<number, Atteint>>;
  constructor(private g: Graphe, private suivis: ReadonlySet<number>, capacite = 2000) {
    this.cache = new LRU(capacite);
  }
  depuis(graines: number[]): Map<number, Atteint> {
    const cle = [...new Set(graines)].sort((a, b) => a - b).join(",");
    const deja = this.cache.get(cle);
    if (deja) return deja;
    const r = bfs(this.g, graines, this.suivis, 2);
    this.cache.set(cle, r);
    return r;
  }
}
