// Lien vers les concepts : les n-grammes (1 à 4 termes) de la question et du code, ramenés à leur forme canonique
// (synonymes), sont cherchés parmi les clés des concepts de l'ontologie. Puis chemins dans le graphe CSR (BFS ≤ 2 sauts).
import type { Index } from "../index/charger.js";
import { ARETE } from "../index/types.js";
import { Chemins, type Atteint } from "./csr.js";
import type { Requete } from "./priseEnCharge.js";
import { canonique } from "../texte/synonymes.js";

export type ConceptLie = { k: number; cle: string; etiquette: string; specificite: number };

export function lierConcepts(ix: Index, r: Requete, max = 8): ConceptLie[] {
  const L = Math.max(1, ix.manifeste.comptes.lecons);
  const trouves = new Map<number, ConceptLie>();
  const chercher = (t: string[]) => {
    for (let i = 0; i < t.length; i++)
      for (let n = 1; n <= 4 && i + n <= t.length; n++) {
        const cle = canonique(t.slice(i, i + n).join(" "));
        const k = ix.conceptParCle.get(cle);
        if (k === undefined || trouves.has(k)) continue;
        const c = ix.ontologie.concepts[k];
        trouves.set(k, { k, cle, etiquette: c.e, specificite: Math.log(1 + L / Math.max(1, c.df)) * (1 + 0.3 * (n - 1)) });
      }
  };
  chercher(r.termes);
  chercher(r.termesCode);
  chercher(r.termesContexte);
  return [...trouves.values()].sort((a, b) => b.specificite - a.specificite).slice(0, max);
}

const SUIVIS = new Set<number>([ARETE.mentionnePar, ARETE.cooccurrence, ARETE.prerequis, ARETE.requiert]);
let chemins: Chemins | null = null;
let cheminsDe: Index | null = null;

export function cheminsDepuis(ix: Index): Chemins {
  if (!chemins || cheminsDe !== ix) ((chemins = new Chemins(ix.graphe, SUIVIS, 2000)), (cheminsDe = ix));
  return chemins;
}

/** Distance (1 ou 2 sauts) de chaque leçon atteinte depuis les concepts liés. */
export function leconsAtteintes(ix: Index, lies: ConceptLie[]): { distances: Map<number, number>; atteints: Map<number, Atteint> } {
  const distances = new Map<number, number>();
  if (!lies.length) return { distances, atteints: new Map() };
  const atteints = cheminsDepuis(ix).depuis(lies.map((c) => ix.noeudConcept(c.k)));
  for (const [n, a] of atteints) {
    const li = ix.leconDuNoeud(n);
    if (li >= 0) distances.set(li, a.distance);
  }
  return { distances, atteints };
}
