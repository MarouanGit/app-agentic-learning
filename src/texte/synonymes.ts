// Petit dictionnaire de synonymes français ↔ anglais (et sigles) du catalogue. La première forme sert d'étiquette.
// Utilisé des deux côtés : l'index range ces formes sous un même concept ; le moteur élargit la requête BM25.
import { termes } from "./normaliser.js";

export const SYNONYMES: string[][] = [
  ["jointure", "join", "joindre", "inner join", "left join"],
  ["requête", "query", "requete sql"],
  ["sous-requête", "subquery", "sous requete"],
  ["regroupement", "group by", "groupby", "grouper", "agrégation", "aggregation"],
  ["fonction de fenêtre", "window function", "fonction fenetre", "over partition"],
  ["clé primaire", "primary key"],
  ["clé étrangère", "foreign key"],
  ["base de données", "database", "bdd", "sgbd"],
  ["tableau croisé dynamique", "pivot table", "tcd", "pivot"],
  ["tableau de bord", "dashboard", "rapport power bi"],
  ["mesure", "measure", "mesure dax"],
  ["colonne calculée", "calculated column"],
  ["modèle en étoile", "star schema", "schéma en étoile"],
  ["boucle", "loop", "for", "while"],
  ["fonction", "function", "def"],
  ["liste", "list"],
  ["dictionnaire", "dict", "dictionary"],
  ["chaîne de caractères", "string", "str", "chaine"],
  ["tuple", "n-uplet"],
  ["classe", "class", "objet", "object", "poo"],
  ["condition", "if", "else", "elif", "conditionnelle"],
  ["exception", "try", "except", "erreur python"],
  ["tri", "sort", "trier", "order by", "sorted"],
  ["filtre", "filter", "filtrer", "where"],
  ["moyenne", "mean", "average", "avg"],
  ["somme", "sum"],
  ["valeur manquante", "missing value", "nan", "null", "valeurs nulles", "dropna", "fillna"],
  ["doublon", "duplicate", "drop_duplicates", "dédoublonnage"],
  ["jeu de données", "dataset", "data set"],
  ["dataframe", "data frame", "pandas dataframe"],
  ["graphique", "chart", "graph", "plot", "visualisation", "dataviz"],
  ["nettoyage des données", "data cleaning", "nettoyer"],
  ["intelligence artificielle", "ia", "ai", "artificial intelligence"],
  ["ia générative", "generative ai", "genai", "gen ai"],
  ["apprentissage automatique", "machine learning", "ml"],
  ["apprentissage profond", "deep learning"],
  ["réseau de neurones", "neural network", "neurones"],
  ["modèle de langage", "llm", "large language model", "grand modèle de langage"],
  ["invite", "prompt", "prompting", "requête au modèle"],
  ["ingénierie de prompt", "prompt engineering"],
  ["plongement", "embedding", "embeddings", "vectorisation"],
  ["génération augmentée", "rag", "retrieval augmented generation"],
  ["agent", "agent ia", "ai agent", "agentique", "agentic"],
  ["automatisation", "automation", "automatiser", "workflow", "flux de travail", "scénario make"],
  ["no-code", "nocode", "no code", "low-code", "lowcode"],
  ["surapprentissage", "overfitting", "sur-apprentissage"],
  ["validation croisée", "cross validation", "cross-validation"],
  ["régression linéaire", "linear regression"],
  ["régression logistique", "logistic regression"],
  ["arbre de décision", "decision tree"],
  ["forêt aléatoire", "random forest"],
  ["classification", "classifier", "classifieur"],
  ["déploiement", "deployment", "déployer", "deploy", "mise en production"],
  ["conteneur", "container", "docker"],
  ["dépôt", "repository", "repo", "git"],
  ["branche", "branch"],
  ["terminal", "shell", "ligne de commande", "bash", "console"],
  ["droits", "permissions", "chmod"],
  ["api", "interface de programmation", "endpoint", "api rest"],
  ["moissonnage", "web scraping", "scraping", "scraper"],
  ["carnet", "notebook", "jupyter"],
  ["tableur", "excel", "spreadsheet", "google sheets"],
  ["gouvernance des données", "data governance"],
  ["rgpd", "gdpr", "données personnelles"],
  ["entrepôt de données", "data warehouse", "entrepot"],
  ["lac de données", "data lake"],
  ["pipeline", "etl", "elt", "chaîne de traitement"],
  ["indicateur", "kpi", "indicateur clé"],
  ["persona", "personae", "profil client"],
  ["campagne", "campaign", "campagne marketing"],
];

export type Groupe = { etiquette: string; cles: string[] };

/** Chaque groupe : son étiquette et la suite de termes (racinisés) de chacune de ses formes. */
export const GROUPES: Groupe[] = SYNONYMES.map((formes) => ({
  etiquette: formes[0],
  cles: [...new Set(formes.map((f) => termes(f).join(" ")).filter(Boolean))],
}));

const PAR_CLE = new Map<string, number>();
GROUPES.forEach((g, i) => g.cles.forEach((c) => PAR_CLE.has(c) || PAR_CLE.set(c, i)));
const LONGUEUR_MAX = Math.max(...GROUPES.flatMap((g) => g.cles.map((c) => c.split(" ").length)));

/** Groupes de synonymes présents dans une suite de termes (formes de 1 à N termes consécutifs). */
export function groupesPresents(t: string[]): Set<number> {
  const vus = new Set<number>();
  for (let i = 0; i < t.length; i++)
    for (let n = 1; n <= LONGUEUR_MAX && i + n <= t.length; n++) {
      const g = PAR_CLE.get(t.slice(i, i + n).join(" "));
      if (g !== undefined) vus.add(g);
    }
  return vus;
}

/** Clé canonique d'une forme (suite de termes) : celle de l'étiquette de son groupe, sinon la forme elle-même. */
export function canonique(cle: string): string {
  const g = PAR_CLE.get(cle);
  return g === undefined ? cle : GROUPES[g].cles[0];
}

/** Termes ajoutés à une requête par ses synonymes (sans ceux qu'elle contient déjà). */
export function expansion(t: string[]): string[] {
  const deja = new Set(t);
  const ajout = new Set<string>();
  for (const g of groupesPresents(t)) for (const c of GROUPES[g].cles) for (const x of c.split(" ")) if (!deja.has(x)) ajout.add(x);
  return [...ajout];
}
