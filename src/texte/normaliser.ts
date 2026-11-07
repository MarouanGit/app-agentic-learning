// Normalisation commune à la construction de l'index et au moteur : minuscules, accents retirés, découpe en mots,
// mots vides français et anglais, racinisation légère du français (racine.ts).
import { racine } from "./racine.js";

/** Minuscules sans accents ni ligatures (œ → oe), espaces normalisés. */
export function plier(texte: string): string {
  return texte
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'");
}

// Mots vides : articles, pronoms, prépositions, auxiliaires, mots interrogatifs et formules de politesse.
// « in », « on », « as », « is » sont aussi des mots-clés SQL/Python : on les garde volontairement hors de cette liste.
const VIDES = new Set(
  (
    "a ai aie aient aies ait as au aux avec avoir avons avez ont c ca ce ceci cela celle celles celui ces cet cette ceux chaque chez comme comment " +
    "d dans de des du donc dont elle elles en encore entre es est et etaient etait etant ete etre eu eux fait faire faut il ils j je l la le les leur leurs lui " +
    "m ma mais me meme mes moi mon n ne ni nos notre nous ou par parce pas peu peut peuvent peux plus pour pourquoi qu quand que quel quelle quelles quels qui quoi " +
    "s sa sans se ses si sien soi soit son sont sous suis sur t ta te tes toi ton tous tout toute toutes tres tu un une unes uns vers voici voila vos votre vous y " +
    "bonjour merci svp stp please hello salut aide aider aidez explique expliquer expliquez expliques dis dire peux-tu pouvez-vous veux voudrais aimerais " +
    "the an of to and or for with by it this that these those what why how when where which who do does did be been are was were can could would should i you we they"
  ).split(/\s+/),
);

export const estVide = (mot: string) => VIDES.has(mot);

/** Mots bruts pliés (sans filtrage), identifiants de code compris : « df.groupby » → df, groupby ; « group_by » reste entier. */
export function mots(texte: string): string[] {
  return plier(texte).split(/[^a-z0-9_+#]+/).filter((m) => m.length > 0 && m.length <= 40);
}

/** Termes d'index : mots pliés, sans mots vides, racinisés. */
export function termes(texte: string): string[] {
  const out: string[] = [];
  for (const m of mots(texte)) {
    if (m.length < 2 && !/\d/.test(m)) continue;
    if (VIDES.has(m)) continue;
    out.push(racine(m));
    // Identifiant composé : on indexe aussi ses parties (group_by → group, by).
    if (m.includes("_")) for (const p of m.split("_")) if (p.length >= 3 && !VIDES.has(p)) out.push(racine(p));
  }
  return out;
}

export const nombreDeMots = (texte: string) => (texte.match(/\S+/g) ?? []).length;
