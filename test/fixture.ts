// Mini-index construit en mémoire avec les vraies fonctions de construction (BM25, CSR, normalisation) :
// deux cours, quatre leçons dont une retirée, sans vecteurs (l'agent dense ne renvoie rien).
import { definirIndex, type Index } from "../src/index/charger.js";
import { ARETE, DRAPEAU, type Concept, type Ontologie, type Passage } from "../src/index/types.js";
import { construireBM25 } from "../src/moteur/bm25.js";
import { construireCSR, type Arete } from "../src/moteur/csr.js";
import { termes } from "../src/texte/normaliser.js";
import { canonique } from "../src/texte/synonymes.js";

export function fixture(): Index {
  const ontologie: Ontologie = {
    rubriques: [{ titre: "Langages et skills" }],
    cours: [
      { id: 5, slug: "apprendre-sql", titre: "Apprendre SQL", r: [0] },
      { id: 4, slug: "apprendre-python", titre: "Apprendre Python", r: [0] },
    ],
    modules: [
      { id: 50, c: 0, titre: "Jointures et agrégats", chapitre: null },
      { id: 40, c: 1, titre: "Listes", chapitre: null },
    ],
    lecons: [
      { id: 1, slug: "sql-join", titre: "Les jointures SQL", type: "code", p: [[0, 0, 1]], r: 0 },
      { id: 2, slug: "sql-group-by", titre: "GROUP BY : regrouper", type: "code", p: [[0, 0, 2]], r: 0 },
      { id: 3, slug: "py-liste", titre: "Les listes Python", type: "code", p: [[1, 1, 1]], r: 0 },
      { id: 4, slug: "sql-vues", titre: "Les vues matérialisées", type: "text", p: [], r: 1 },
    ],
    concepts: [],
  };
  const passages: Passage[] = [
    { l: 0, c: 0, m: 0, h: ["INNER JOIN et LEFT JOIN"], t: "Une jointure INNER JOIN combine deux tables sur une colonne commune et ne garde que les lignes qui correspondent. LEFT JOIN garde toutes les lignes de la table de gauche, avec NULL quand il n'y a pas de correspondance.", f: 0 },
    { l: 1, c: 0, m: 0, h: [], t: "GROUP BY regroupe les lignes qui partagent une même valeur. On calcule ensuite une somme ou une moyenne par groupe, par exemple le total des ventes par client.", f: 0 },
    { l: 2, c: 1, m: 1, h: [], t: "Une liste Python se crée avec des crochets. La méthode append ajoute un élément à la fin de la liste.", f: 0 },
    { l: 3, c: 0, m: 0, h: [], t: "Les vues matérialisées", f: DRAPEAU.retire },
  ];
  const formes: [string, Concept["t"]][] = [["jointure", "synonyme"], ["INNER JOIN", "code"], ["LEFT JOIN", "code"], ["GROUP BY", "code"], ["liste", "synonyme"], ["append", "code"], ["vues matérialisées", "titre"], ["SQL", "techno"], ["Python", "techno"]];
  const docs = passages.map((p) => [...termes(ontologie.lecons[p.l].titre), ...termes(p.h.join(" ")), ...termes(p.t)]);
  for (const [f, t] of formes) {
    const k = canonique(termes(f).join(" "));
    if (!ontologie.concepts.some((c) => c.k === k)) ontologie.concepts.push({ k, e: f, t, df: 1 });
  }
  const R = 1, C = 2, M = 2, L = 4, K = ontologie.concepts.length;
  const aretes: Arete[] = [];
  const deux = (de: number, vers: number, type: number, inv: number) => aretes.push({ de, vers, type, poids: 1 }, { de: vers, vers: de, type: inv, poids: 1 });
  deux(0, R + 0, ARETE.contient, ARETE.dans);
  deux(0, R + 1, ARETE.contient, ARETE.dans);
  deux(R + 0, R + C + 0, ARETE.contient, ARETE.dans);
  deux(R + 1, R + C + 1, ARETE.contient, ARETE.dans);
  [0, 0, 1, 0].forEach((m, li) => deux(R + C + m, R + C + M + li, ARETE.contient, ARETE.dans));
  deux(R + C + M + 0, R + C + M + 1, ARETE.prerequis, ARETE.requiert);
  // Mentions : n-grammes des passages qui sont des clés de concepts.
  docs.forEach((d, pi) => {
    const vus = new Set<number>();
    for (let i = 0; i < d.length; i++)
      for (let n = 1; n <= 4 && i + n <= d.length; n++) {
        const k = ontologie.concepts.findIndex((c) => c.k === canonique(d.slice(i, i + n).join(" ")));
        if (k >= 0 && !vus.has(k)) (vus.add(k), deux(R + C + M + passages[pi].l, R + C + M + L + k, ARETE.mentionne, ARETE.mentionnePar));
      }
  });
  const graphe = construireCSR(R + C + M + L + K, aretes);
  const bm25 = construireBM25(docs);
  const ix: Index = {
    manifeste: {
      version: 1,
      construitLe: "2026-11-07T00:00:00.000Z",
      exporteLe: "2026-11-07T00:00:00.000Z",
      comptes: { rubriques: R, cours: C, modules: M, lecons: 3, leconsRetirees: 1, passages: 3, concepts: K, aretes: graphe.cibles.length, termes: bm25.termes.size, empreintes: 0 },
      decoupe: { min: 80, max: 220, dansLaFourchette: 0, motsMoyens: 30 },
      bm25: { k1: 1.2, b: 0.75, longueurMoyenne: bm25.moyenne },
      modeles: { vecteurs: "aucun" },
      fichiers: {},
      dureeMs: 0,
    },
    ontologie,
    passages,
    bm25,
    graphe,
    vecteurs: new Int8Array(0),
    echelles: new Float32Array(0),
    empreintes: new Uint32Array(0),
    coursParSlug: new Map(ontologie.cours.map((c, i) => [c.slug, i])),
    leconParSlug: new Map(ontologie.lecons.map((l, i) => [l.slug, i])),
    conceptParCle: new Map(ontologie.concepts.map((c, i) => [c.k, i])),
    base: { R, C, M, L, K },
    noeudLecon: (li) => R + C + M + li,
    noeudConcept: (ki) => R + C + M + L + ki,
    leconDuNoeud: (n) => (n >= R + C + M && n < R + C + M + L ? n - (R + C + M) : -1),
    retiree: Uint8Array.from(ontologie.lecons.map((l) => l.r)),
    coursDeLecon: ontologie.lecons.map((l) => l.p.map(([c]) => c)),
  };
  definirIndex(ix);
  return ix;
}

/** Moteurs factices : pas de vecteurs, rédaction scriptée. */
export const moteursFactices = (texte: string) => ({
  vecteurs: async (t: string[]) => t.map(() => new Float32Array(384)),
  rediger: async () => ({ texte, delaiDepasse: false }),
});
