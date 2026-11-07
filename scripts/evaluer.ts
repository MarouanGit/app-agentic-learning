// Évaluation locale de bout en bout (vrais modèles, vrai index) à travers les gestionnaires HTTP de api/ :
// précision et rappel des refus, validité des citations, leçon attendue dans le top 3, latences p50/p95 de ask et complete.
//
//   tsx --env-file=.env.local scripts/evaluer.ts            (npm run evaluer)
//   tsx --env-file=.env.local scripts/evaluer.ts --sans-complete
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { POST as ask } from "../api/ask.js";
import { POST as complete } from "../api/complete.js";
import { chargerIndex } from "../src/index/charger.js";
import { citationsCoherentes } from "../src/moteur/citations.js";
import { ancrer } from "../src/moteur/ancrage.js";
import { ponderer } from "../src/moteur/appui.js";
import { leconsAtteintes, lierConcepts } from "../src/moteur/concepts.js";
import { prendreEnCharge, type Mode } from "../src/moteur/priseEnCharge.js";
import { classer } from "../src/moteur/tri.js";
import { vecteurs } from "../src/modeles/modeles.js";
import type { ReponseAsk } from "../src/moteur/repondre.js";

const RACINE = join(import.meta.dirname, "..");
type Q = { id: string; question: string; mode?: string; attendues?: string[]; cours?: string; lecon?: string; controle?: boolean };
const jeu = JSON.parse(readFileSync(join(RACINE, "eval/questions.json"), "utf8")) as { dans_programme: Q[]; hors_programme: Q[]; completions: { id: string; langage: string; avant: string; apres: string }[] };
const secret = process.env.AGENTIC_SECRET;
if (!secret) throw new Error("AGENTIC_SECRET manquant : lancer avec --env-file=.env.local");
const ix = chargerIndex();

const appel = async (f: (r: Request) => Promise<Response>, chemin: string, corps: unknown) => {
  const t = performance.now();
  const res = await f(new Request(`http://local${chemin}`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(corps) }));
  const ms = performance.now() - t;
  if (res.status !== 200) throw new Error(`${chemin} : HTTP ${res.status} ${await res.text()}`);
  return { corps: await res.json(), ms };
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : 0;
};

/** Une réponse a des citations valides si : [n] cohérents, URL exacte, leçon placée dans ce cours, extrait tiré de la leçon. */
function citationsValides(r: ReponseAsk): boolean {
  if (!r.citations.length || !citationsCoherentes(r.texte, r.citations.length)) return false;
  return r.citations.every((c, i) => {
    const li = ix.leconParSlug.get(c.lecon);
    const ci = ix.coursParSlug.get(c.cours);
    if (li === undefined || ci === undefined || c.n !== i + 1 || ix.retiree[li]) return false;
    if (c.url !== `/cours/${c.cours}/${c.lecon}` || !ix.coursDeLecon[li].includes(ci) || c.extrait.length > 280) return false;
    const debut = c.extrait.replace(/…$/, "").slice(0, 60).replace(/\s+/g, " ");
    return ix.passages.some((p) => p.l === li && p.t.replace(/\s+/g, " ").includes(debut));
  });
}

/** Leçons du top 3 du tri sémantique (avant les portes et la rédaction) : qualité de la recherche seule. */
async function top3Tri(q: Q): Promise<string[]> {
  const r = prendreEnCharge({ question: q.question, mode: (q.mode ?? "aide") as Mode, autorises: "tous", cours: q.cours, lecon: q.lecon }, ix);
  const an = await ancrer(ix, r, async () => (await vecteurs([r.texteDense], "query: "))[0]);
  const cl = classer(ix, an.candidats, ponderer(ix, r), leconsAtteintes(ix, lierConcepts(ix, r)).distances);
  return [...new Set(cl.filter((c) => !c.retire).map((c) => ix.ontologie.lecons[ix.passages[c.p].l].slug))].slice(0, 3);
}

const t0 = Date.now();
const lignes: Record<string, unknown>[] = [];
const msAsk: number[] = [];
let premierAsk = 0;
console.log("Questions dans le programme…");
for (const q of jeu.dans_programme) {
  const { corps, ms } = await appel(ask, "/api/ask", { question: q.question, mode: q.mode ?? "aide", autorises: "tous", cours: q.cours, lecon: q.lecon });
  const r = corps as ReponseAsk;
  if (!premierAsk) premierAsk = ms;
  else msAsk.push(ms);
  const lecons = [...new Set(r.citations.map((c) => c.lecon))];
  const top3 = lecons.slice(0, 3).some((l) => q.attendues!.includes(l));
  const tri = (await top3Tri(q)).some((l) => q.attendues!.includes(l));
  lignes.push({ id: q.id, controle: !!q.controle, programme: true, statut: r.statut, porte: r.refus?.porte ?? null, modele: r.trace.modele, citations: r.citations.length, valides: r.statut === "reponse" ? citationsValides(r) : null, top3, top3Tri: tri, lecons: lecons.slice(0, 3), ms: Math.round(ms) });
  process.stdout.write(`  ${r.statut === "reponse" ? (top3 ? "✓" : "·") : "✗"} ${q.id.padEnd(22)} ${r.statut.padEnd(7)} ${r.refus ? `porte ${r.refus.porte} ${r.refus.code}` : r.trace.modele.padEnd(10)} ${Math.round(ms)} ms\n`);
}
console.log("Questions hors programme…");
for (const q of jeu.hors_programme) {
  const { corps, ms } = await appel(ask, "/api/ask", { question: q.question, mode: "aide", autorises: "tous" });
  const r = corps as ReponseAsk;
  msAsk.push(ms);
  lignes.push({ id: q.id, controle: !!q.controle, programme: false, statut: r.statut, porte: r.refus?.porte ?? null, modele: r.trace.modele, citations: r.citations.length, ms: Math.round(ms) });
  process.stdout.write(`  ${r.statut === "refus" ? "✓" : "✗"} ${q.id.padEnd(22)} ${r.statut.padEnd(7)} ${r.refus ? `porte ${r.refus.porte} ${r.refus.code}` : r.trace.modele} ${Math.round(ms)} ms\n`);
}

const msComplete: number[] = [];
let premierComplete = 0;
let suggestions = 0;
const exemples: Record<string, string> = {};
if (!process.argv.includes("--sans-complete")) {
  console.log("Autocomplétion…");
  // Premier appel : chargement du modèle (suggestion vide attendue si le chargement dépasse 4 s), puis 2 passes.
  const amorce = await appel(complete, "/api/complete", { langage: "python", avant: "x = 1\n", apres: "" });
  premierComplete = amorce.ms;
  await new Promise((r) => setTimeout(r, 8000)); // laisse finir le chargement en arrière-plan
  for (let passe = 0; passe < 2; passe++)
    for (const c of jeu.completions) {
      const { corps, ms } = await appel(complete, "/api/complete", { langage: c.langage, avant: c.avant, apres: c.apres });
      const s = (corps as { suggestion: string }).suggestion;
      msComplete.push(ms);
      if (s) suggestions++;
      if (passe === 0) exemples[c.id] = s;
    }
}

function metriques(ls: Record<string, unknown>[]) {
  const prog = ls.filter((l) => l.programme);
  const hors = ls.filter((l) => !l.programme);
  const refuses = ls.filter((l) => l.statut === "refus");
  const reponses = prog.filter((l) => l.statut === "reponse");
  const vraisRefus = hors.filter((l) => l.statut === "refus").length;
  return {
    questions: { programme: prog.length, horsProgramme: hors.length },
    refus: {
      precision: Number((vraisRefus / Math.max(1, refuses.length)).toFixed(3)),
      rappel: Number((vraisRefus / Math.max(1, hors.length)).toFixed(3)),
      fauxRefus: prog.length - reponses.length,
      parPorte: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, refuses.filter((l) => l.porte === n).length])),
    },
    reponses: { redigees: reponses.filter((l) => l.modele !== "extractif").length, extractives: reponses.filter((l) => l.modele === "extractif").length },
    citationsValides: Number((reponses.filter((l) => l.valides).length / Math.max(1, reponses.length)).toFixed(3)),
    top3Citations: Number((prog.filter((l) => l.top3).length / Math.max(1, prog.length)).toFixed(3)),
    top3Tri: Number((prog.filter((l) => l.top3Tri).length / Math.max(1, prog.length)).toFixed(3)),
  };
}
const m = {
  ...metriques(lignes),
  controle: metriques(lignes.filter((l) => l.controle)),
  latences: {
    ask: { froidMs: Math.round(premierAsk), p50: Math.round(quantile(msAsk, 0.5)), p95: Math.round(quantile(msAsk, 0.95)) },
    complete: { froidMs: Math.round(premierComplete), p50: Math.round(quantile(msComplete, 0.5)), p95: Math.round(quantile(msComplete, 0.95)), nonVides: `${suggestions}/${msComplete.length}` },
  },
  dureeS: Math.round((Date.now() - t0) / 1000),
};
writeFileSync(join(RACINE, "eval/resultats.json"), JSON.stringify({ date: new Date().toISOString(), metriques: m, lignes, exemplesCompletion: exemples }, null, 2));
console.log(JSON.stringify(m, null, 2));
