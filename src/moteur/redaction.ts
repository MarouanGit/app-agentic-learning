// Rédaction par Qwen2.5-0.5B-Instruct sous consigne stricte (français, seulement les passages, citations [n],
// 120 mots au plus ; en mode « indice », jamais le code de la solution), puis nettoyage du texte produit.
import type { Index } from "../index/charger.js";
import { recouvrement } from "../texte/empreintes.js";
import { nombreDeMots } from "../texte/normaliser.js";
import { phrases } from "../texte/phrases.js";
import type { Mode } from "./priseEnCharge.js";
import type { Classe } from "./tri.js";

export const MOTS_MAX = 120;
const MOTS_PAR_PASSAGE = 110;

const CONSIGNES: Record<Mode, string> = {
  aide: "Écris une réponse de 2 ou 3 phrases qui reprend les extraits utiles.",
  explique: "Explique la notion simplement, comme à un débutant, en 2 ou 3 phrases qui reprennent les extraits utiles.",
  indice:
    "Donne seulement un indice en 1 ou 2 phrases : la notion à revoir ou la piste à suivre. Ne donne ni la réponse complète, ni de code, ni de commande toute faite.",
};

/** Consigne système : réécrire les extraits, rien ajouter (un modèle de 0,5 B paraphrase mieux qu'il ne compose). */
export function consigneSysteme(_mode: Mode): string {
  return "Tu es le tuteur des formations DATAROCKSTARS. Tu réécris des extraits de cours en français clair, en 120 mots au plus. Tu n'ajoutes aucune information qui n'est pas dans les extraits. Si les extraits ne répondent pas à la question, écris seulement : JE NE SAIS PAS.";
}

/** Consigne finale, placée après les extraits (un petit modèle suit mieux ce qu'il lit en dernier). */
export function consigneFinale(mode: Mode): string {
  return `${CONSIGNES[mode]} Après chaque phrase, mets le numéro de son extrait entre crochets, comme [1]. Ne pose pas de question.`;
}

/** Fenêtre d'environ 110 mots du passage, centrée sur sa meilleure phrase d'appui. */
export function fenetre(texte: string, phraseAppui: string, max = MOTS_PAR_PASSAGE): string {
  const ph = phrases(texte);
  if (nombreDeMots(texte) <= max || !ph.length) return texte.replace(/\s+/g, " ").trim();
  const i = Math.max(0, ph.findIndex((p) => p === phraseAppui));
  let debut = i;
  let fin = i;
  let n = nombreDeMots(ph[i]);
  while (n < max && (debut > 0 || fin < ph.length - 1)) {
    if (fin < ph.length - 1 && n + nombreDeMots(ph[fin + 1]) <= max) n += nombreDeMots(ph[++fin]);
    else if (debut > 0 && n + nombreDeMots(ph[debut - 1]) <= max) n += nombreDeMots(ph[--debut]);
    else break;
  }
  return ph.slice(debut, fin + 1).join(" ");
}

export function messages(ix: Index, mode: Mode, question: string, code: string, retenus: Classe[]) {
  // Extraits courts (≈ 60 mots autour de la meilleure phrase d'appui) : moins de bruit pour un modèle de 0,5 B.
  const blocs = retenus.map((c, i) => `[${i + 1}] ${fenetre(ix.passages[c.p].t, c.phrase, 60).replace(/^Objectifs : /, "")}`);
  const codeBloc = code ? `\n\nCode de l'apprenant :\n\`\`\`\n${code.slice(0, 1200)}\n\`\`\`` : "";
  return [
    { role: "system" as const, content: consigneSysteme(mode) },
    { role: "user" as const, content: `Question d'un apprenant : ${question}${codeBloc}\n\nExtraits du cours :\n${blocs.join("\n")}\n\n${consigneFinale(mode)}` },
  ];
}

export const neSaitPas = (t: string) => /JE NE SAIS PAS/i.test(t) || /^\s*(je ne (sais|peux) pas|désolé)/i.test(t);

/** Coupe à 120 mots sur une fin de phrase (ou au mot, avec une ellipse, s'il n'y en a pas). */
export function borner(texte: string, max = MOTS_MAX): string {
  const t = texte.trim();
  if (nombreDeMots(t) <= max) return t;
  const mots = t.split(/(\s+)/);
  let n = 0;
  let coupe = "";
  for (const m of mots) {
    if (/\S/.test(m)) n++;
    if (n > max) break;
    coupe += m;
  }
  const fin = Math.max(coupe.lastIndexOf(". "), coupe.lastIndexOf("] "), coupe.lastIndexOf(".\n"), coupe.lastIndexOf("!"), coupe.lastIndexOf("?"));
  if (fin > coupe.length * 0.5) return coupe.slice(0, fin + 1).trim();
  return coupe.trim().replace(/[,;:]$/, "") + "…";
}

/** Mode indice : aucun bloc de code, aucune ligne de code, aucun fragment qui recopie une solution connue. */
export function retirerCode(texte: string, empreintes: Uint32Array): string {
  let t = texte.replace(/```[\s\S]*?(```|$)/g, " ");
  t = t.replace(/`([^`]{25,})`/g, "…");
  const lignes = t.split("\n").filter((l) => {
    const s = l.trim();
    if (!s) return false;
    if (/^(import |from \S+ import|def |class |SELECT |select |\w+\s*=\s*\S+\(|\S+\.\w+\(.*\)\s*$)/.test(s)) return false;
    const r = recouvrement(s, empreintes);
    return !(r.communs >= 1 && r.total > 0 && r.communs / r.total >= 0.3);
  });
  return lignes.join("\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** Nettoyage commun : préambules (« Réponse : »), balises, espaces. */
export function nettoyer(texte: string): string {
  return texte
    .replace(/<\|[^|]*\|>/g, "")
    .replace(/^\s*(réponse|response|indice|explication|extraits?(\s+du\s+cours)?)\s*:\s*/gim, "")
    // Un extrait recopié tel quel (« [2] texte ») : la citation passe en fin de phrase.
    .replace(/^\s*\[(\d+)\]\s*(.+?)\s*$/gm, (_, n: string, t: string) => `${t.replace(/[.!?…:]*$/, "")} [${n}].`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
