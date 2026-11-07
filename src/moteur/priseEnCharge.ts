// Prise en charge de la question : validation stricte de l'entrée, normalisation, mode, contexte (cours et leçon en
// cours), cours autorisés, termes de la requête et de son élargissement par synonymes, identifiants du code de l'apprenant.
import type { Index } from "../index/charger.js";
import { identifiantsDuCode } from "./code.js";
import { termes } from "../texte/normaliser.js";
import { expansion } from "../texte/synonymes.js";

export type Mode = "aide" | "indice" | "explique";
export const MODES: Mode[] = ["aide", "indice", "explique"];
export type Demande = { question: string; cours?: string; lecon?: string; code?: string; mode: Mode; autorises: string[] | "tous" };

export const LIMITES = { question: 500, code: 4000, slug: 200, autorises: 1000 } as const;

export class EntreeInvalide extends Error {}

/** Valide le corps de POST /api/ask (types et tailles) ; lève EntreeInvalide avec un message en français. */
export function validerDemande(corps: unknown): Demande {
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) throw new EntreeInvalide("Corps JSON attendu.");
  const c = corps as Record<string, unknown>;
  if (typeof c.question !== "string") throw new EntreeInvalide("« question » doit être une chaîne.");
  if (c.question.length > LIMITES.question) throw new EntreeInvalide(`« question » dépasse ${LIMITES.question} caractères.`);
  for (const k of ["cours", "lecon"] as const)
    if (c[k] !== undefined && c[k] !== null && (typeof c[k] !== "string" || (c[k] as string).length > LIMITES.slug)) throw new EntreeInvalide(`« ${k} » doit être un identifiant (${LIMITES.slug} caractères au plus).`);
  if (c.code !== undefined && c.code !== null && (typeof c.code !== "string" || c.code.length > LIMITES.code)) throw new EntreeInvalide(`« code » doit être une chaîne de ${LIMITES.code} caractères au plus.`);
  const mode = c.mode ?? "aide";
  if (!MODES.includes(mode as Mode)) throw new EntreeInvalide("« mode » doit valoir aide, indice ou explique.");
  const a = c.autorises;
  if (a !== "tous" && !(Array.isArray(a) && a.length <= LIMITES.autorises && a.every((s) => typeof s === "string" && s.length <= LIMITES.slug)))
    throw new EntreeInvalide("« autorises » doit valoir \"tous\" ou une liste d'identifiants de cours.");
  return { question: c.question, cours: (c.cours as string) || undefined, lecon: (c.lecon as string) || undefined, code: (c.code as string) || undefined, mode: mode as Mode, autorises: a as string[] | "tous" };
}

export type Requete = {
  question: string; // nettoyée (espaces, caractères de contrôle)
  mode: Mode;
  termes: string[]; // termes de la question
  expansion: string[]; // termes ajoutés par les synonymes
  termesCode: string[]; // identifiants tirés du code de l'apprenant
  termesContexte: string[]; // titre de la leçon en cours, quand la question est courte ou creuse
  code: string; // code de l'apprenant (borné), jamais journalisé
  coursIdx: number; // -1 : inconnu
  leconIdx: number; // -1 : inconnue
  tous: boolean;
  autorises: Uint8Array; // par cours de l'index : 1 si autorisé
  nbAutorises: number;
  vague: boolean; // formule creuse (« je ne comprends pas »…)
  texteDense: string; // texte encodé par e5 (« query: »)
};

const VAGUE = /^\s*(je\s+(ne\s+)?(comprends?|pige)\s+(pas|rien)|j'?y\s+arrive\s+pas|(ça|ca|cela)\s+(ne\s+)?(marche|fonctionne)\s+pas|help|aide[\s-]?moi|explique[\s-]?(moi)?|c'?est\s+quoi\s*(ça|ca)?|quoi|pourquoi|comment|hein|\?+|bonjour|salut|merci)\s*[?!.]*\s*$/i;

export function prendreEnCharge(d: Demande, ix: Index): Requete {
  const question = d.question.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const code = (d.code ?? "").slice(0, LIMITES.code);
  const coursIdx = d.cours ? (ix.coursParSlug.get(d.cours) ?? -1) : -1;
  const leconIdx = d.lecon ? (ix.leconParSlug.get(d.lecon) ?? -1) : -1;
  const tous = d.autorises === "tous";
  const autorises = new Uint8Array(ix.ontologie.cours.length);
  if (tous) autorises.fill(1);
  else for (const s of d.autorises as string[]) {
    const i = ix.coursParSlug.get(s);
    if (i !== undefined) autorises[i] = 1;
  }
  const nbAutorises = autorises.reduce((s, x) => s + x, 0);
  const t = termes(question);
  const vague = VAGUE.test(question);
  const titreLecon = leconIdx >= 0 ? ix.ontologie.lecons[leconIdx].titre : "";
  // Question courte ou creuse posée depuis une leçon : la leçon sert de contexte à la recherche dense.
  const texteDense = (vague || t.length < 3) && titreLecon ? `${question} (${titreLecon})` : question;
  return {
    question,
    mode: d.mode,
    termes: t,
    expansion: expansion(t),
    termesCode: code ? identifiantsDuCode(code) : [],
    termesContexte: (vague || t.length < 3) && titreLecon ? termes(titreLecon).filter((x) => !t.includes(x)) : [],
    code,
    coursIdx,
    leconIdx,
    tous,
    autorises,
    nbAutorises,
    vague,
    texteDense,
  };
}
