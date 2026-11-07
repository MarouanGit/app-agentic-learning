// Appui lexical : quelle part de la question (pondérée par l'IDF de ses termes) un passage, ou une de ses phrases, couvre.
// Sert au tri sémantique, à la porte 4 (une phrase citable ?) et à l'extrait des citations.
import type { Index } from "../index/charger.js";
import { idf } from "./bm25.js";
import { LRU } from "./lru.js";
import type { Requete } from "./priseEnCharge.js";
import { termes } from "../texte/normaliser.js";
import { phrases } from "../texte/phrases.js";

export type Ponderation = { termes: { t: string; w: number }[]; expansion: { t: string; w: number }[]; total: number };

export function ponderer(ix: Index, r: Requete): Ponderation {
  const vus = new Set<string>();
  const tq = r.termes.filter((t) => !vus.has(t) && vus.add(t)).map((t) => ({ t, w: Math.max(0.2, idf(ix.bm25, t)) }));
  const te = r.expansion.map((t) => ({ t, w: 0.5 * Math.max(0.2, idf(ix.bm25, t)) }));
  return { termes: tq, expansion: te, total: tq.reduce((s, x) => s + x.w, 0) };
}

export function couverture(p: Ponderation, ens: Set<string>): number {
  if (p.total <= 0) return 0;
  let s = 0;
  for (const { t, w } of p.termes) if (ens.has(t)) s += w;
  for (const { t, w } of p.expansion) if (ens.has(t)) s += w;
  return Math.min(1, s / p.total);
}

type Decoupe = { tous: Set<string>; phrases: { texte: string; termes: Set<string> }[] };
const cache = new LRU<number, Decoupe>(4000);

export function decoupePassage(ix: Index, p: number): Decoupe {
  let d = cache.get(p);
  if (!d) {
    const ps = ix.passages[p];
    const titre = ix.ontologie.lecons[ps.l].titre;
    const ph = phrases(ps.t).map((texte) => ({ texte, termes: new Set(termes(texte)) }));
    d = { tous: new Set([...termes(titre), ...termes(ps.h.join(" ")), ...ph.flatMap((x) => [...x.termes])]), phrases: ph };
    cache.set(p, d);
  }
  return d;
}

/** Meilleure phrase d'appui d'un passage pour la question, et la couverture du passage entier. */
export function appui(ix: Index, pond: Ponderation, p: number): { phrase: string; couverturePhrase: number; couverturePassage: number } {
  const d = decoupePassage(ix, p);
  let best = { phrase: d.phrases[0]?.texte ?? ix.passages[p].t, couverturePhrase: 0 };
  for (const ph of d.phrases) {
    const c = couverture(pond, ph.termes);
    if (c > best.couverturePhrase) best = { phrase: ph.texte, couverturePhrase: c };
  }
  return { ...best, couverturePassage: couverture(pond, d.tous) };
}
