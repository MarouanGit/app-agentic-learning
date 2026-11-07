// Autocomplétion de code (POST /api/complete) : remplissage au milieu (FIM) par Qwen2.5-Coder 0.5B (modèle de base),
// 48 jetons au plus, arrêt à la première ligne vide, échéance de 4 s puis suggestion vide.
import { COMPLETION, nomModele } from "../modeles/catalogue.js";
import { EntreeInvalide } from "./priseEnCharge.js";

export const LIMITES_COMPLETE = { avant: 2000, apres: 1000, langage: 40, suggestion: 200, jetons: 48, delaiMs: 4000 } as const;

export type DemandeCompletion = { langage: string; avant: string; apres: string; cours?: string; lecon?: string };
export type ReponseCompletion = { suggestion: string; modele: string; ms: number };
export type Fim = (avant: string, apres: string, o: { maxJetons: number; echeance: number; fini: (t: string) => boolean }) => Promise<{ texte: string; delaiDepasse: boolean }>;

export function validerCompletion(corps: unknown): DemandeCompletion {
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) throw new EntreeInvalide("Corps JSON attendu.");
  const c = corps as Record<string, unknown>;
  if (typeof c.langage !== "string" || !c.langage || c.langage.length > LIMITES_COMPLETE.langage) throw new EntreeInvalide("« langage » doit être une chaîne courte.");
  if (typeof c.avant !== "string" || c.avant.length > LIMITES_COMPLETE.avant) throw new EntreeInvalide(`« avant » doit être une chaîne de ${LIMITES_COMPLETE.avant} caractères au plus.`);
  if (c.apres !== undefined && (typeof c.apres !== "string" || c.apres.length > LIMITES_COMPLETE.apres)) throw new EntreeInvalide(`« apres » doit être une chaîne de ${LIMITES_COMPLETE.apres} caractères au plus.`);
  for (const k of ["cours", "lecon"] as const) if (c[k] !== undefined && c[k] !== null && (typeof c[k] !== "string" || (c[k] as string).length > 200)) throw new EntreeInvalide(`« ${k} » doit être un identifiant.`);
  return { langage: c.langage.toLowerCase(), avant: c.avant, apres: (c.apres as string) ?? "", cours: (c.cours as string) || undefined, lecon: (c.lecon as string) || undefined };
}

/** Texte produit jugé terminé : une ligne vide (fin de bloc) ou un jeton de fin. */
const SPECIAUX = /<\|(endoftext|fim_pad|fim_middle|fim_prefix|fim_suffix|file_sep|im_end|im_start|repo_name)\|>/;
export const finCompletion = (t: string) => /\n[ \t]*\n/.test(t.replace(/^(\s*<\|[a-z_]+\|>)+/, "")) || SPECIAUX.test(t.replace(/^(\s*<\|[a-z_]+\|>)+/, ""));

/**
 * Nettoyage : jetons spéciaux de tête retirés, coupe au jeton spécial suivant et à la ligne vide, une seule ligne si le
 * curseur est au milieu d'une ligne, arrêt à la première ligne répétée, recouvrement avec la suite retiré, 200 caractères au plus.
 */
export function nettoyerSuggestion(brut: string, apres: string, avant = ""): string {
  let s = brut.replace(/^(\s*<\|[a-z_]+\|>)+/, "");
  const sp = s.search(/<\|[a-z_]+\|>/);
  if (sp >= 0) s = s.slice(0, sp);
  const vide = s.search(/\n[ \t]*\n/);
  if (vide >= 0) s = s.slice(0, vide);
  // Curseur au milieu d'une ligne (la suite de la ligne n'est pas vide) : la suggestion tient sur cette ligne.
  const resteLigne = apres.split("\n")[0];
  if (resteLigne.trim()) {
    s = s.split("\n")[0];
    const r = resteLigne.trim();
    if (s.trimEnd().endsWith(r)) s = s.trimEnd().slice(0, -r.length);
  }
  // Lignes de tête qui recopient la fin du code : ignorées. Ensuite, arrêt à la première ligne déjà vue (boucle).
  const fin = avant.split("\n").slice(-3).map((l) => l.trim()).filter(Boolean);
  const vues = new Set(fin);
  const lignes: string[] = [];
  for (const l of s.split("\n")) {
    const t = l.trim();
    if (!lignes.length && t && fin.includes(t)) continue;
    if (t && vues.has(t)) break;
    if (t) vues.add(t);
    lignes.push(l);
  }
  // Curseur déjà indenté (dernière ligne de « avant » faite d'espaces) : la première ligne ne se réindente pas.
  const derniere = avant.split("\n").pop() ?? "";
  if (lignes.length && /^[ \t]+$/.test(derniere)) lignes[0] = lignes[0].replace(/^[ \t]+/, "");
  s = lignes.join("\n").replace(/\s+$/, "");
  // Recouvrement avec la suite : « avant|suggestion|apres » ne doit pas dupliquer le début de « apres ».
  const debut = apres.replace(/^\s+/, "");
  for (let n = Math.min(s.length, debut.length, 80); n >= 3; n--)
    if (s.endsWith(debut.slice(0, n))) {
      s = s.slice(0, -n).replace(/\s+$/, "");
      break;
    }
  if (s.length > LIMITES_COMPLETE.suggestion) {
    const c = s.slice(0, LIMITES_COMPLETE.suggestion);
    const nl = c.lastIndexOf("\n");
    s = nl > 40 ? c.slice(0, nl) : c;
  }
  return s;
}

const COMMENTAIRES: Record<string, string> = { python: "#", py: "#", r: "#", bash: "#", shell: "#", sh: "#", yaml: "#", sql: "--", dax: "--", javascript: "//", js: "//", typescript: "//", ts: "//" };

export async function completer(d: DemandeCompletion, fim: Fim, titreLecon?: string): Promise<ReponseCompletion> {
  const t0 = performance.now();
  const echeance = Date.now() + LIMITES_COMPLETE.delaiMs;
  const modele = nomModele(COMPLETION);
  if (!d.avant.trim() && !d.apres.trim()) return { suggestion: "", modele, ms: 0 };
  // Contexte léger : le titre de la leçon en commentaire, si le code est court (le nom des variables en profite).
  const com = COMMENTAIRES[d.langage];
  const avant = titreLecon && com && d.avant.length < 1500 ? `${com} ${titreLecon}\n${d.avant}` : d.avant;
  let suggestion = "";
  try {
    const delai = new Promise<null>((res) => setTimeout(() => res(null), Math.max(0, echeance - Date.now())).unref?.());
    const g = await Promise.race([fim(avant, d.apres, { maxJetons: LIMITES_COMPLETE.jetons, echeance, fini: finCompletion }), delai]);
    if (g && !g.delaiDepasse && Date.now() <= echeance + 50) suggestion = nettoyerSuggestion(g.texte, d.apres, d.avant);
  } catch {
    suggestion = "";
  }
  return { suggestion, modele, ms: Math.round(performance.now() - t0) };
}
