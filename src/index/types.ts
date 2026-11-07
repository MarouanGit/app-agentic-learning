// Format de l'index (data/index/), écrit par scripts/construire.ts et lu par le moteur (src/index/charger.ts).

export const DIMENSION = 384; // multilingual-e5-small

/** Types de nœuds de l'ontologie : rubrique › cours › module › leçon, plus les concepts. */
export const NOEUD = { rubrique: 0, cours: 1, module: 2, lecon: 3, concept: 4 } as const;

/** Types d'arêtes du graphe CSR. Chaque arête est stockée dans les deux sens (le sens inverse a son propre type). */
export const ARETE = {
  contient: 0, // rubrique → cours → module → leçon
  dans: 1, // inverse de contient
  mentionne: 2, // leçon → concept
  mentionnePar: 3, // concept → leçon
  prerequis: 4, // leçon précédente → leçon suivante (ordre du cours)
  requiert: 5, // inverse de prerequis
  cooccurrence: 6, // concept ↔ concept, pondérée
} as const;
export const NOMS_ARETES = ["contient", "dans", "mentionne", "mentionnePar", "prerequis", "requiert", "cooccurrence"];

export const DRAPEAU = { code: 1, solutionProche: 2, retire: 4 } as const;

export type Rubrique = { titre: string };
export type Cours = { id: number; slug: string; titre: string; r: number[] };
export type ModuleIdx = { id: number; c: number; titre: string; chapitre: string | null };
/** p : placements [cours, module, rang dans le cours] ; r : 1 si retiré (non publié, masqué ou cours non publié). */
export type Lecon = { id: number; slug: string; titre: string; type: string; p: [number, number, number][]; r: 0 | 1 };
/** k : clé normalisée (termes racinisés, forme canonique des synonymes) ; e : étiquette ; t : origine ; df : leçons qui le mentionnent. */
export type Concept = { k: string; e: string; t: "techno" | "titre" | "gras" | "code" | "synonyme"; df: number };
export type Ontologie = { rubriques: Rubrique[]; cours: Cours[]; modules: ModuleIdx[]; lecons: Lecon[]; concepts: Concept[] };
/** l : leçon ; c, m : cours et module du placement principal ; h : chemin de titres dans la leçon ; t : texte ; f : drapeaux. */
export type Passage = { l: number; c: number; m: number; h: string[]; t: string; f: number };

export type Manifeste = {
  version: 1;
  construitLe: string;
  exporteLe: string;
  comptes: { rubriques: number; cours: number; modules: number; lecons: number; leconsRetirees: number; passages: number; concepts: number; aretes: number; termes: number; empreintes: number };
  decoupe: { min: number; max: number; dansLaFourchette: number; motsMoyens: number };
  bm25: { k1: number; b: number; longueurMoyenne: number };
  modeles: { vecteurs: string };
  fichiers: Record<string, { octets: number; sha256: string }>;
  dureeMs: number;
};
