// Chargement de l'index au runtime (une fois par instance) : fichiers de data/index/, empreintes vérifiées contre le
// manifeste, structures dérivées (dictionnaires de slugs, nœuds du graphe, leçons retirées).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IndexBM25 } from "../moteur/bm25.js";
import type { Graphe } from "../moteur/csr.js";
import { lireBinaire } from "./binaire.js";
import { DIMENSION, DRAPEAU, type Manifeste, type Ontologie, type Passage } from "./types.js";

export type Index = {
  manifeste: Manifeste;
  ontologie: Ontologie;
  passages: Passage[];
  bm25: IndexBM25;
  graphe: Graphe;
  vecteurs: Int8Array<ArrayBufferLike>;
  echelles: Float32Array<ArrayBufferLike>;
  empreintes: Uint32Array<ArrayBufferLike>;
  // Dérivés
  coursParSlug: Map<string, number>;
  leconParSlug: Map<string, number>;
  conceptParCle: Map<string, number>;
  base: { R: number; C: number; M: number; L: number; K: number };
  noeudLecon: (li: number) => number;
  noeudConcept: (ki: number) => number;
  leconDuNoeud: (n: number) => number; // -1 si le nœud n'est pas une leçon
  retiree: Uint8Array; // par leçon : 1 si retirée (index ou AGENTIC_RETRAITS)
  coursDeLecon: number[][]; // cours où la leçon est placée (publiée)
};

let cache: Index | null = null;

export function dossierIndex() {
  return process.env.AGENTIC_INDEX ?? join(process.env.AGENTIC_RACINE ?? process.cwd(), "data/index");
}

export function chargerIndex(dossier = dossierIndex()): Index {
  if (cache) return cache;
  const lire = (f: string) => readFileSync(join(dossier, f));
  const manifeste = JSON.parse(lire("manifeste.json").toString("utf8")) as Manifeste;
  for (const [f, { sha256 }] of Object.entries(manifeste.fichiers)) {
    const h = createHash("sha256").update(lire(f)).digest("hex");
    if (h !== sha256) throw new Error(`Index corrompu : ${f}`);
  }
  const ontologie = JSON.parse(lire("ontologie.json").toString("utf8")) as Ontologie;
  const passages = JSON.parse(lire("passages.json").toString("utf8")) as Passage[];
  const vocab = JSON.parse(lire("bm25-termes.json").toString("utf8")) as string[];
  const b = lireBinaire(join(dossier, "bm25.bin"));
  const bm25: IndexBM25 = {
    termes: new Map(vocab.map((t, i) => [t, i])),
    offsets: b.tableaux.offsets as Uint32Array,
    docs: b.tableaux.docs as Uint32Array,
    tfs: b.tableaux.tfs as Uint16Array,
    longueurs: b.tableaux.longueurs as Uint16Array,
    moyenne: b.meta.moyenne as number,
    k1: b.meta.k1 as number,
    b: b.meta.b as number,
  };
  const g = lireBinaire(join(dossier, "graphe.bin"));
  const graphe: Graphe = { offsets: g.tableaux.offsets as Uint32Array, cibles: g.tableaux.cibles as Uint32Array, types: g.tableaux.types as Uint8Array, poids: g.tableaux.poids as Float32Array };
  const base = g.meta.noeuds as Index["base"];
  let vecteurs: Int8Array<ArrayBufferLike> = new Int8Array(0);
  let echelles: Float32Array<ArrayBufferLike> = new Float32Array(0);
  try {
    const v = lireBinaire(join(dossier, "vecteurs.bin"));
    if ((v.meta.dimension as number) !== DIMENSION) throw new Error("dimension inattendue");
    vecteurs = v.tableaux.vecteurs as Int8Array;
    echelles = v.tableaux.echelles as Float32Array;
  } catch (e) {
    if (manifeste.fichiers["vecteurs.bin"]) throw e; // annoncés par le manifeste : leur absence est une erreur
  }
  const empreintes = lireBinaire(join(dossier, "empreintes.bin")).tableaux.empreintes as Uint32Array;

  const { R, C, M, L } = base;
  const retiree = new Uint8Array(ontologie.lecons.length);
  ontologie.lecons.forEach((l, i) => (retiree[i] = l.r));
  const leconParSlug = new Map(ontologie.lecons.map((l, i) => [l.slug, i]));
  // Retraits à chaud (sans reconstruire l'index) : AGENTIC_RETRAITS = slugs de leçons séparés par des virgules.
  for (const s of (process.env.AGENTIC_RETRAITS ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const i = leconParSlug.get(s);
    if (i !== undefined) retiree[i] = 1;
  }
  for (let pi = 0; pi < passages.length; pi++) if (retiree[passages[pi].l]) passages[pi].f |= DRAPEAU.retire;

  cache = {
    manifeste,
    ontologie,
    passages,
    bm25,
    graphe,
    vecteurs,
    echelles,
    empreintes,
    coursParSlug: new Map(ontologie.cours.map((c, i) => [c.slug, i])),
    leconParSlug,
    conceptParCle: new Map(ontologie.concepts.map((c, i) => [c.k, i])),
    base,
    noeudLecon: (li) => R + C + M + li,
    noeudConcept: (ki) => R + C + M + L + ki,
    leconDuNoeud: (n) => (n >= R + C + M && n < R + C + M + L ? n - (R + C + M) : -1),
    retiree,
    coursDeLecon: ontologie.lecons.map((l) => l.p.map(([c]) => c)),
  };
  return cache;
}

/** Pour les tests : injecter un index construit en mémoire. */
export function definirIndex(ix: Index | null) {
  cache = ix;
}
