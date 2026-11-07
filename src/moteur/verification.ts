// Porte 6 « non-verifie » : chaque phrase rédigée doit être impliquée par un passage cité. Faute de modèle
// d'implication textuelle, on mesure l'implication par similarité : part des termes de la phrase présents dans le
// passage (inclusion lexicale) et cosinus e5 phrase ↔ passage. Une phrase appuyée par un autre passage fourni voit
// sa citation corrigée ; une phrase sans appui fait échouer la porte (réponse extractive ou refus).
import type { Index } from "../index/charger.js";
import { cosinus } from "./ancrage.js";
import { decoupePassage } from "./appui.js";
import { citesDans, sansCitations } from "./citations.js";
import { termes } from "../texte/normaliser.js";
import { phrases } from "../texte/phrases.js";

export const SEUILS_VERIF = { inclusion: 0.6, inclusionAvecCos: 0.4, cos: 0.85, termesMin: 3 };

export type PhraseVerifiee = { texte: string; cites: number[]; appui: number; inclusion: number; cos: number; ok: boolean; neutre: boolean };
export type Verification = { ok: boolean; phrases: PhraseVerifiee[]; texte: string };

/**
 * `passages[i]` : indice (dans l'index) du passage numéroté [i + 1] dans le texte.
 * `vecteurs` : encodeur des phrases (« query: »), facultatif (sans lui, seule l'inclusion lexicale compte).
 */
export async function verifier(ix: Index, texte: string, passages: number[], vecteurs?: (t: string[]) => Promise<Float32Array[]>): Promise<Verification> {
  // Phrases par ligne (les listes gardent leurs retours à la ligne).
  const lignes = texte.split(/\n+/).map((l) => phrases(l).filter((p) => sansCitations(p).length > 0)).filter((l) => l.length);
  const brutes = lignes.flat();
  const nettes = brutes.map(sansCitations);
  const vecs = vecteurs && ix.vecteurs.length && nettes.length ? await vecteurs(nettes) : null;
  const res: PhraseVerifiee[] = brutes.map((b, i) => {
    const t = new Set(termes(nettes[i]));
    const cites = citesDans(b).filter((n) => n >= 1 && n <= passages.length);
    // Phrase courte ou question (une question n'affirme rien) : neutre, elle ne compte ni pour ni contre.
    if (t.size < SEUILS_VERIF.termesMin || /\?\s*$/.test(nettes[i])) return { texte: b, cites, appui: cites[0] ?? 0, inclusion: 1, cos: 1, ok: true, neutre: true };
    const mesurer = (n: number) => {
      const d = decoupePassage(ix, passages[n - 1]);
      let commun = 0;
      for (const x of t) if (d.tous.has(x)) commun++;
      const inclusion = commun / t.size;
      const cos = vecs ? cosinus(ix, vecs[i], passages[n - 1]) : 0;
      const ok = inclusion >= SEUILS_VERIF.inclusion || (inclusion >= SEUILS_VERIF.inclusionAvecCos && cos >= SEUILS_VERIF.cos);
      return { n, inclusion, cos, ok };
    };
    const essais = [...cites, ...passages.map((_, j) => j + 1).filter((n) => !cites.includes(n))].map(mesurer);
    const bon = essais.find((e) => e.ok) ?? [...essais].sort((a, b) => b.inclusion - a.inclusion)[0];
    return { texte: b, cites, appui: bon?.n ?? 0, inclusion: bon?.inclusion ?? 0, cos: bon?.cos ?? 0, ok: !!bon?.ok, neutre: false };
  });
  const pleines = res.filter((p) => !p.neutre);
  const ok = pleines.length > 0 && pleines.every((p) => p.ok);
  // Citation corrigée : une phrase appuyée par un autre passage que celui qu'elle cite porte la citation de son appui.
  const recrire = (p: PhraseVerifiee) => {
    const m = sansCitations(p.texte).match(/^([\s\S]*?)([.!?…:]*)$/)!;
    const base = m[1].trimEnd();
    const ponct = m[2] || ".";
    const nums = p.neutre ? p.cites : p.ok ? (p.cites.includes(p.appui) ? p.cites : [p.appui]) : p.cites;
    const c = [...new Set(nums.filter((n) => n > 0))].map((n) => `[${n}]`).join("");
    return c ? `${base} ${c}${ponct}` : `${base}${ponct}`;
  };
  let k = 0;
  const corrige = lignes.map((l) => l.map(() => recrire(res[k++])).join(" ")).join("\n");
  return { ok, phrases: res, texte: corrige };
}
