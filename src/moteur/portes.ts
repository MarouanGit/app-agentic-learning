// Échelle de refus à 6 portes. Les portes 1 à 5 s'évaluent EN PARALLÈLE sur l'état commun de l'ancrage ; la porte 6
// vérifie le texte rédigé (verification.ts). Le refus renvoyé est celui de la première porte fermée, dans l'ordre.
import type { Index } from "../index/charger.js";
import type { Ancrage } from "./ancrage.js";
import type { ConceptLie } from "./concepts.js";
import type { Requete } from "./priseEnCharge.js";
import type { Classe } from "./tri.js";
import { idf } from "./bm25.js";

export type CodePorte = "aucune-entree" | "trop-vague" | "hors-programme" | "non-citable" | "retire" | "non-verifie";
export type Porte = { n: 1 | 2 | 3 | 4 | 5 | 6; code: CodePorte; nom: string; message: string };

export const PORTES: Porte[] = [
  { n: 1, code: "aucune-entree", nom: "aucune-entree", message: "Je ne trouve aucune prise dans cette question : elle est vide, ou aucun de ses mots n'apparaît dans les cours auxquels vous avez accès. Reformulez-la avec les mots du cours." },
  { n: 2, code: "trop-vague", nom: "trop-vague", message: "Votre question est trop vague pour que je retrouve le bon passage. Précisez la notion, la commande ou l'étape qui vous bloque, par exemple : « À quoi sert GROUP BY ? »." },
  { n: 3, code: "hors-programme", nom: "hors-programme", message: "Cette question sort du programme : je ne trouve aucun chemin vers une leçon des cours auxquels vous avez accès. Je réponds seulement à partir du contenu de vos formations." },
  { n: 4, code: "non-citable", nom: "non-citable", message: "Des leçons sont proches, mais aucun passage ne contient de phrase qui appuie une réponse. Plutôt que d'inventer, je préfère m'abstenir : posez la question à votre formateur." },
  { n: 5, code: "retire", nom: "retire", message: "Le contenu qui répond à cette question a été retiré ou n'est pas publié. Je ne peux pas m'en servir ; votre formateur vous indiquera la leçon à jour." },
  { n: 6, code: "non-verifie", nom: "non-verifie", message: "Je n'ai pas pu vérifier ma réponse, phrase par phrase, contre les passages du cours : je préfère ne pas vous la donner. Reformulez la question ou ouvrez les leçons proches." },
];

/** Seuils (calibrés sur eval/questions.json, voir README). Cosinus e5-small : sans rapport ≈ 0,75, très proche ≈ 0,9. */
export const SEUILS = {
  cosSansMot: 0.86, // porte 1 : aucun mot connu, mais la recherche dense trouve un passage très proche
  idfMotSeul: 4.0, // porte 2 : un seul mot connu, et commun
  specificiteMin: 3.0, // porte 2 : somme des IDF des mots connus
  couvertureChemin: 0.5, // porte 3 : un passage sur un chemin doit couvrir la moitié de la question…
  cosChemin: 0.845, // …ou lui être proche
  cosPlancher: 0.855, // porte 3 : plancher sémantique du passage atteint par un chemin (hors programme ≤ 0,85 sur l'éval)
  cosSansConcept: 0.865, // porte 3 sans concept lié
  couvertureSansConcept: 0.5,
  phraseCitable: 0.5, // porte 4 : une phrase couvre la moitié de la question
  couverturePassageCitable: 0.66,
  cosCitable: 0.84,
  topChemin: 10,
  topCitable: 5,
};

export type EtatPortes = { ix: Index; r: Requete; ancrage: Ancrage; lies: ConceptLie[]; classes: Classe[] };
export type ResultatPorte = { n: number; nom: string; ok: boolean; ms: number };

export const citable = (c: Classe) => c.couverturePhrase >= SEUILS.phraseCitable || (c.couverture >= SEUILS.couverturePassageCitable && c.cos >= SEUILS.cosCitable);

function motsConnus(e: EtatPortes) {
  return e.r.termes.filter((t) => e.ix.bm25.termes.has(t));
}

export const reglesPortes: ((e: EtatPortes) => boolean)[] = [
  // 1 · aucune-entree
  (e) => {
    if (!/[\p{L}\p{N}]/u.test(e.r.question)) return false;
    if (e.r.nbAutorises === 0) return false;
    if (e.r.vague) return true; // une formule creuse est une entrée : c'est la porte 2 qui juge
    if (e.ancrage.candidats.length === 0) return false;
    if (!motsConnus(e).length && !e.lies.length && !e.r.termesCode.length && e.ancrage.cosMax < SEUILS.cosSansMot) return false;
    return true;
  },
  // 2 · trop-vague
  (e) => {
    const contexte = e.r.leconIdx >= 0 || e.r.code.length > 0;
    if (e.r.vague) return contexte;
    if (contexte) return true;
    const connus = [...new Set(motsConnus(e))];
    const idfs = connus.map((t) => idf(e.ix.bm25, t));
    const spec = idfs.reduce((s, x) => s + x, 0);
    if (connus.length <= 1 && Math.max(0, ...idfs) < SEUILS.idfMotSeul && !e.lies.length) return false;
    return spec >= SEUILS.specificiteMin || e.lies.length > 0;
  },
  // 3 · hors-programme : un chemin (concept → leçon autorisée, 2 sauts au plus) vers un passage pertinent
  (e) => {
    const top = e.classes.slice(0, SEUILS.topChemin);
    const dense = e.ix.vecteurs.length > 0; // sans vecteurs (index de test), pas de plancher sémantique
    if (e.lies.length) return top.some((c) => c.distance > 0 && (!dense || c.cos >= SEUILS.cosPlancher) && (c.couverture >= SEUILS.couvertureChemin || c.cos >= SEUILS.cosChemin));
    return top.some((c) => c.cos >= SEUILS.cosSansConcept && c.couverture >= SEUILS.couvertureSansConcept);
  },
  // 4 · non-citable : au moins un passage a une phrase qui appuie la réponse
  (e) => e.classes.slice(0, SEUILS.topCitable).some(citable),
  // 5 · retire : la leçon en cours, ou tout ce qui est citable, est retiré
  (e) => {
    if (e.r.leconIdx >= 0 && e.ix.retiree[e.r.leconIdx]) return false;
    const citables = e.classes.slice(0, SEUILS.topCitable).filter(citable);
    if (!citables.length) return true; // rien de citable : c'est la porte 4 qui refuse
    return citables.some((c) => !c.retire) || e.classes.slice(0, SEUILS.topChemin).some((c) => !c.retire && citable(c));
  },
];

/** Portes 1 à 5 évaluées en parallèle (chacune mesure sa durée). */
export async function evaluerPortes(e: EtatPortes): Promise<ResultatPorte[]> {
  return Promise.all(
    reglesPortes.map(async (regle, i) => {
      const t = performance.now();
      const ok = regle(e);
      return { n: i + 1, nom: PORTES[i].nom, ok, ms: Number((performance.now() - t).toFixed(2)) };
    }),
  );
}

export function premiereFermee(res: ResultatPorte[]): Porte | null {
  const f = [...res].sort((a, b) => a.n - b.n).find((p) => !p.ok);
  return f ? PORTES[f.n - 1] : null;
}
