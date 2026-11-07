// Construction hors ligne de l'index (data/index/) à partir de l'export du LMS (data/export/lms.json).
// Aucun modèle génératif : seul l'encodeur multilingual-e5-small calcule les vecteurs des passages.
//
//   npm run construire            (après npm run exporter)
//   tsx scripts/construire.ts --sans-vecteurs   # essai rapide de la découpe et de l'ontologie
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ecrireBinaire } from "../src/index/binaire.js";
import { ARETE, DIMENSION, DRAPEAU, type Concept, type Cours, type Lecon, type Manifeste, type ModuleIdx, type Ontologie, type Passage, type Rubrique } from "../src/index/types.js";
import { construireBM25 } from "../src/moteur/bm25.js";
import { construireCSR, nbAretes, type Arete } from "../src/moteur/csr.js";
import { VECTEURS, nomModele } from "../src/modeles/catalogue.js";
import { empreintesCode, recouvrement } from "../src/texte/empreintes.js";
import { nombreDeMots, termes } from "../src/texte/normaliser.js";
import { phrases } from "../src/texte/phrases.js";
import { canonique, GROUPES } from "../src/texte/synonymes.js";
import { TECHNOS } from "../src/texte/technos.js";
import { extraireBlocs, htmlVersSegments, identifiantsCode, type Extraction, type Segment } from "./lib/extraction.js";

const RACINE = join(import.meta.dirname, "..");
const SORTIE = join(RACINE, "data/index");
const MIN = 80;
const MAX = 220;
const sansVecteurs = process.argv.includes("--sans-vecteurs");
const t0 = Date.now();

type Export = {
  exporteLe: string;
  cours: { id: number; slug: string; title: string; category: string; programmes: { slug: string; titre: string; domaine: string | null }[] }[];
  modules: { id: number; courseId: number; title: string; part: string | null; chapter: string | null; position: number }[];
  placements: { moduleId: number; lessonId: number; position: number; visible: boolean }[];
  lecons: { id: number; slug: string; title: string; type: string; objectives: string[]; published: boolean; content: unknown; exercise: Record<string, string> | null; notebookId: number | null; labId: number | null }[];
  labs: { id: number; title: string; summary: string | null; tools: string[] | null; steps: { id: string; title: string; instructionsHtml: string }[] }[];
  notebooks: { id: number; title: string; summary: string | null }[];
  coursRetires: { slug: string; title: string; lessons: { slug: string; title: string }[] }[];
  empreintesSolutions: number[];
};
const ex: Export = JSON.parse(readFileSync(join(RACINE, "data/export/lms.json"), "utf8"));

// ── 1. Ontologie : rubrique › cours › module › leçon ───────────────────────────────────────────────────────────────
const rubriques: Rubrique[] = [];
const rubriqueIdx = new Map<string, number>();
const rubrique = (titre: string) => {
  let i = rubriqueIdx.get(titre);
  if (i === undefined) rubriqueIdx.set(titre, (i = rubriques.push({ titre }) - 1));
  return i;
};
const cours: Cours[] = ex.cours.map((c) => ({
  id: c.id,
  slug: c.slug,
  titre: c.title,
  r: c.programmes.length ? c.programmes.map((p) => rubrique(p.titre)) : [rubrique(c.category === "langage" ? "Langages et skills" : "Autres cours")],
}));
const coursParId = new Map(cours.map((c, i) => [c.id, i]));
const modulesTries = [...ex.modules].sort((a, b) => a.courseId - b.courseId || a.position - b.position || a.id - b.id);
const modules: ModuleIdx[] = modulesTries.map((m) => ({ id: m.id, c: coursParId.get(m.courseId)!, titre: m.title, chapitre: m.chapter }));
const moduleParId = new Map(modules.map((m, i) => [m.id, i]));

const leconExport = new Map(ex.lecons.map((l) => [l.id, l]));
const lecons: Lecon[] = [];
const leconParId = new Map<number, number>();
const rangDansCours = new Map<number, number>(); // compteur par cours
// Placements dans l'ordre du cours (module puis position) : il donne aussi les arêtes « prérequis ».
const ordreCours = new Map<number, number[]>(); // cours → leçons (indices) dans l'ordre
const placementRetire = new Map<number, [number, number]>(); // leçon retirée → son placement (masqué) dans un cours publié
const placementsTries = [...ex.placements].sort((a, b) => (moduleParId.get(a.moduleId)! - moduleParId.get(b.moduleId)!) || a.position - b.position);
for (const p of placementsTries) {
  const l = leconExport.get(p.lessonId);
  const mi = moduleParId.get(p.moduleId);
  if (!l || mi === undefined) continue;
  const ci = modules[mi].c;
  let li = leconParId.get(l.id);
  const publiee = l.published && p.visible;
  if (li === undefined) {
    li = lecons.push({ id: l.id, slug: l.slug, titre: l.title, type: l.type, p: [], r: 1 }) - 1;
    leconParId.set(l.id, li);
  }
  const lecon = lecons[li];
  if (!publiee && !placementRetire.has(li)) placementRetire.set(li, [ci, mi]);
  if (publiee) {
    lecon.r = 0;
    if (lecon.p.some(([c]) => c === ci)) continue; // un composant n'est déployé qu'une fois par cours
    const rang = (rangDansCours.get(ci) ?? 0) + 1;
    rangDansCours.set(ci, rang);
    lecon.p.push([ci, mi, rang]);
    ordreCours.set(ci, [...(ordreCours.get(ci) ?? []), li]);
  }
}
// Leçons des cours non publiés : connues par leur titre seulement (porte 5).
for (const c of ex.coursRetires)
  for (const l of c.lessons)
    if (!lecons.some((x) => x.slug === l.slug)) lecons.push({ id: -1, slug: l.slug, titre: l.title, type: "text", p: [], r: 1 });

// ── 2. Extraction et découpe en passages ───────────────────────────────────────────────────────────────────────────
const empreintes = new Set<number>(ex.empreintesSolutions);
const labs = new Map(ex.labs.map((l) => [l.id, l]));
const notebooks = new Map(ex.notebooks.map((n) => [n.id, n]));

function extraireLecon(l: Export["lecons"][number]): Extraction {
  const x = extraireBlocs(l.content);
  if (l.objectives?.length) x.segments.unshift({ titres: [], texte: `Objectifs : ${l.objectives.join(" ; ")}.`, code: false });
  if (l.exercise) {
    const e = l.exercise;
    const titres = e.title ? [e.title] : [];
    if (e.instructionsHtml) htmlVersSegments(e.instructionsHtml, titres, x);
    if (e.example?.trim()) (x.segments.push({ titres: [...titres, "Exemple"], texte: e.example.trim(), code: true, langage: e.lang }), x.identifiants.push(...identifiantsCode(e.example)));
    if (e.starterCode?.trim() && nombreDeMots(e.starterCode) > 3) x.segments.push({ titres: [...titres, "Code de départ"], texte: e.starterCode.trim(), code: true, langage: e.lang });
  }
  const lab = l.labId ? labs.get(l.labId) : undefined;
  if (lab) {
    if (lab.summary) x.segments.push({ titres: [lab.title], texte: lab.summary + (lab.tools?.length ? ` Outils : ${lab.tools.join(", ")}.` : ""), code: false });
    for (const s of lab.steps) htmlVersSegments(s.instructionsHtml ?? "", [lab.title, s.title], x);
  }
  const nb = l.notebookId ? notebooks.get(l.notebookId) : undefined;
  if (nb) x.segments.push({ titres: [nb.title], texte: `Notebook « ${nb.title} ».${nb.summary ? " " + nb.summary : ""}`, code: false });
  for (const s of x.solutions) for (const h of empreintesCode(s)) empreintes.add(h);
  return x;
}

/** Coupe un segment trop long : par phrases (prose) ou par lignes (code), morceaux de MAX mots au plus. */
function fragmenter(s: Segment): Segment[] {
  if (nombreDeMots(s.texte) <= MAX) return [s];
  const unites = s.code ? s.texte.split("\n") : phrases(s.texte);
  const out: Segment[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const u of unites) {
    const w = nombreDeMots(u);
    if (w > MAX) {
      // Unité géante (ligne ou phrase sans ponctuation) : coupe dure par mots.
      const mots = u.split(/\s+/);
      for (let i = 0; i < mots.length; i += MAX) out.push({ ...s, texte: mots.slice(i, i + MAX).join(" ") });
      continue;
    }
    if (n + w > MAX && cur.length) (out.push({ ...s, texte: cur.join(s.code ? "\n" : " ") }), (cur = []), (n = 0));
    cur.push(u);
    n += w;
  }
  if (cur.length) out.push({ ...s, texte: cur.join(s.code ? "\n" : " ") });
  return out;
}

function decouper(segments: Segment[]): { titres: string[]; texte: string; code: boolean }[] {
  const bruts: { titres: string[]; parts: string[]; mots: number; code: boolean }[] = [];
  let cur: (typeof bruts)[number] | null = null;
  for (const s of segments.flatMap(fragmenter)) {
    const w = nombreDeMots(s.texte);
    const autreTitre = cur && cur.titres.join("›") !== s.titres.join("›");
    if (cur && (cur.mots + w > MAX || (autreTitre && cur.mots >= MIN))) (bruts.push(cur), (cur = null));
    cur ??= { titres: s.titres, parts: [], mots: 0, code: false };
    cur.parts.push(s.texte);
    cur.mots += w;
    cur.code ||= s.code;
  }
  if (cur) bruts.push(cur);
  // Passages trop courts : fusionnés avec le voisin quand la somme reste dans la fourchette.
  for (let i = 0; i < bruts.length; i++) {
    const p = bruts[i];
    if (p.mots >= MIN || bruts.length === 1) continue;
    const prev = bruts[i - 1];
    const next = bruts[i + 1];
    if (prev && prev.mots + p.mots <= MAX) {
      prev.parts.push(...p.parts);
      prev.mots += p.mots;
      prev.code ||= p.code;
      bruts.splice(i--, 1);
    } else if (next && next.mots + p.mots <= MAX) {
      next.parts.unshift(...p.parts);
      next.mots += p.mots;
      next.titres = p.titres.length <= next.titres.length ? p.titres : next.titres;
      next.code ||= p.code;
      bruts.splice(i--, 1);
    }
  }
  return bruts.map((b) => ({ titres: b.titres, texte: b.parts.join("\n"), code: b.code }));
}

const passages: Passage[] = [];
const termesPassages: string[][] = [];
const textesVecteurs: string[] = [];
const candidatsConcepts = new Map<string, { formes: Map<string, number>; t: Concept["t"] }>();

function candidat(forme: string, t: Concept["t"]) {
  const f = forme.replace(/^[\d.\s·:–-]+/, "").replace(/[«»"“”()[\]]/g, "").trim();
  if (f.length < 2 || f.length > 60) return;
  const tt = termes(f);
  if (!tt.length || tt.length > 4) return;
  if (tt.length === 1 && (tt[0].length < 3 || /^\d+$/.test(tt[0]))) return;
  const cle = canonique(tt.join(" "));
  const c = candidatsConcepts.get(cle) ?? { formes: new Map(), t };
  // L'étiquette d'un groupe de synonymes (ou d'une techno) l'emporte toujours sur les formes rencontrées dans le texte.
  c.formes.set(f, (c.formes.get(f) ?? 0) + (t === "synonyme" || t === "techno" ? 1e6 : 1));
  if (t === "techno" || t === "synonyme") c.t = t;
  candidatsConcepts.set(cle, c);
}
for (const t of TECHNOS) candidat(t, "techno");
for (const g of GROUPES) candidat(g.etiquette, "synonyme");

const empreintesTriees = () => Uint32Array.from([...empreintes].sort((a, b) => a - b));
const extractions = new Map<number, Extraction>();
for (const l of ex.lecons) if (l.published && leconParId.has(l.id) && lecons[leconParId.get(l.id)!].r === 0) extractions.set(l.id, extraireLecon(l));
const triees = empreintesTriees();

for (const [id, x] of extractions) {
  const li = leconParId.get(id)!;
  const lecon = lecons[li];
  const [c, m] = lecon.p[0];
  candidat(lecon.titre, "titre");
  for (const part of lecon.titre.split(/\s[:–—-]\s|,|\s·\s/)) candidat(part, "titre");
  for (const s of x.segments) for (const h of s.titres) candidat(h, "titre");
  for (const g of x.gras) candidat(g, "gras");
  for (const k of x.codeEnLigne) if (k.split(/\s+/).length <= 3) candidat(k, "code");
  for (const k of x.identifiants) candidat(k, "code");
  for (const d of decouper(x.segments)) {
    let f = d.code ? DRAPEAU.code : 0;
    if (d.code) {
      const r = recouvrement(d.texte, triees);
      if (r.communs >= 2 && r.communs / Math.max(1, r.total) >= 0.5) f |= DRAPEAU.solutionProche;
    }
    passages.push({ l: li, c, m, h: d.titres, t: d.texte, f });
    termesPassages.push([...termes(lecon.titre), ...termes(lecon.titre), ...termes(d.titres.join(" ")), ...termes(d.texte)]);
    textesVecteurs.push(`${lecon.titre}${d.titres.length ? " — " + d.titres.join(" › ") : ""}\n${d.texte}`);
  }
}
// Leçons retirées : un passage-titre chacune (jamais cité ; il sert à reconnaître une question sur un contenu retiré).
for (let li = 0; li < lecons.length; li++)
  if (lecons[li].r === 1) {
    const [c, m] = placementRetire.get(li) ?? [-1, -1];
    passages.push({ l: li, c, m, h: [], t: lecons[li].titre, f: DRAPEAU.retire });
    termesPassages.push([...termes(lecons[li].titre), ...termes(lecons[li].titre)]);
    textesVecteurs.push(lecons[li].titre);
  }

// ── 3. Concepts : normalisation, mentions dans les passages, filtrage ───────────────────────────────────────────
const LMAX = 4;
const mentions = new Map<string, Map<number, number>>(); // clé → passage → occurrences
termesPassages.forEach((tt, pi) => {
  for (let i = 0; i < tt.length; i++)
    for (let n = 1; n <= LMAX && i + n <= tt.length; n++) {
      const cle = canonique(tt.slice(i, i + n).join(" "));
      if (!candidatsConcepts.has(cle)) continue;
      const m = mentions.get(cle) ?? new Map<number, number>();
      m.set(pi, (m.get(pi) ?? 0) + 1);
      mentions.set(cle, m);
    }
});
const nbLeconsPubliees = lecons.filter((l) => l.r === 0).length;
const concepts: Concept[] = [];
const conceptParCle = new Map<string, number>();
for (const [cle, c] of candidatsConcepts) {
  const m = mentions.get(cle);
  if (!m) continue;
  const lecs = new Set([...m.keys()].filter((pi) => !(passages[pi].f & DRAPEAU.retire)).map((pi) => passages[pi].l));
  if (!lecs.size) continue;
  const dfL = lecs.size;
  // Trop générique : un concept hors technos et synonymes doit rester rare (3 % des leçons pour un mot seul, 6 % sinon),
  // et un mot seul en gras doit l'être au moins deux fois ou servir de titre.
  const mots = cle.split(" ").length;
  if (c.t !== "techno" && c.t !== "synonyme") {
    if (dfL > nbLeconsPubliees * (mots === 1 ? 0.03 : 0.06)) continue;
    if (mots === 1 && c.t === "gras" && [...c.formes.values()].reduce((s, n) => s + n, 0) < 2) continue;
    if (mots === 1 && cle.length < 4) continue;
  }
  const etiquette = [...c.formes].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  conceptParCle.set(cle, concepts.push({ k: cle, e: etiquette, t: c.t, df: dfL }) - 1);
}

// ── 4. Graphe CSR ───────────────────────────────────────────────────────────────────────────────────────────────
const R = rubriques.length, C = cours.length, M = modules.length, L = lecons.length, K = concepts.length;
const nR = (i: number) => i, nC = (i: number) => R + i, nM = (i: number) => R + C + i, nL = (i: number) => R + C + M + i, nK = (i: number) => R + C + M + L + i;
const aretes: Arete[] = [];
const deux = (de: number, vers: number, type: number, inverse: number, poids = 1) => {
  aretes.push({ de, vers, type, poids });
  aretes.push({ de: vers, vers: de, type: inverse, poids });
};
cours.forEach((c, ci) => c.r.forEach((ri) => deux(nR(ri), nC(ci), ARETE.contient, ARETE.dans)));
modules.forEach((m, mi) => deux(nC(m.c), nM(mi), ARETE.contient, ARETE.dans));
lecons.forEach((l, li) => l.p.forEach(([, mi]) => deux(nM(mi), nL(li), ARETE.contient, ARETE.dans)));
// Une leçon retirée reste rattachée à son module : la question trouve un chemin, puis la porte 5 la refuse.
for (const [li, [, mi]] of placementRetire) if (lecons[li].r === 1) deux(nM(mi), nL(li), ARETE.contient, ARETE.dans);
for (const [, ordre] of ordreCours) for (let i = 1; i < ordre.length; i++) deux(nL(ordre[i - 1]), nL(ordre[i]), ARETE.prerequis, ARETE.requiert);
// Mentions leçon ↔ concept (poids : occurrences dans la leçon) et cooccurrences dans un même passage.
const parPassage = new Map<number, number[]>();
for (const [cle, m] of mentions) {
  const ki = conceptParCle.get(cle);
  if (ki === undefined) continue;
  const parLecon = new Map<number, number>();
  for (const [pi, n] of m) {
    parLecon.set(passages[pi].l, (parLecon.get(passages[pi].l) ?? 0) + n);
    parPassage.set(pi, [...(parPassage.get(pi) ?? []), ki]);
  }
  for (const [li, n] of parLecon) deux(nL(li), nK(ki), ARETE.mentionne, ARETE.mentionnePar, Math.log1p(n));
}
const cooc = new Map<number, Map<number, number>>();
for (const [, ks] of parPassage) {
  const choisis = [...new Set(ks)].sort((a, b) => concepts[a].df - concepts[b].df).slice(0, 25); // les plus spécifiques
  for (let i = 0; i < choisis.length; i++)
    for (let j = i + 1; j < choisis.length; j++) {
      const [a, b] = choisis[i] < choisis[j] ? [choisis[i], choisis[j]] : [choisis[j], choisis[i]];
      const m = cooc.get(a) ?? new Map<number, number>();
      m.set(b, (m.get(b) ?? 0) + 1);
      cooc.set(a, m);
    }
}
const voisinsCooc = new Map<number, { k: number; w: number }[]>();
for (const [a, m] of cooc)
  for (const [b, n] of m) {
    if (n < 2) continue;
    // Poids : information mutuelle ponctuelle positive, bornée (les paires banales pèsent peu).
    const w = Math.max(0.05, Math.log((n * passages.length) / (concepts[a].df * concepts[b].df * 3 + 1)));
    voisinsCooc.set(a, [...(voisinsCooc.get(a) ?? []), { k: b, w }]);
    voisinsCooc.set(b, [...(voisinsCooc.get(b) ?? []), { k: a, w }]);
  }
const dejaCooc = new Set<string>();
for (const [a, vs] of voisinsCooc)
  for (const { k: b, w } of vs.sort((x, y) => y.w - x.w).slice(0, 8)) {
    const cle = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (dejaCooc.has(cle)) continue;
    dejaCooc.add(cle);
    deux(nK(a), nK(b), ARETE.cooccurrence, ARETE.cooccurrence, w);
  }
const N = R + C + M + L + K;
const graphe = construireCSR(N, aretes);

// ── 5. BM25 ────────────────────────────────────────────────────────────────────────────────────────────────────
const bm25 = construireBM25(termesPassages);
const vocab = [...bm25.termes.keys()];

// ── 6. Écriture ──────────────────────────────────────────────────────────────────────────────────────────────────
mkdirSync(SORTIE, { recursive: true });
const ontologie: Ontologie = { rubriques, cours, modules, lecons, concepts };
writeFileSync(join(SORTIE, "ontologie.json"), JSON.stringify(ontologie));
writeFileSync(join(SORTIE, "passages.json"), JSON.stringify(passages));
writeFileSync(join(SORTIE, "bm25-termes.json"), JSON.stringify(vocab));
ecrireBinaire(join(SORTIE, "bm25.bin"), { offsets: bm25.offsets, docs: bm25.docs, tfs: bm25.tfs, longueurs: bm25.longueurs }, { k1: bm25.k1, b: bm25.b, moyenne: bm25.moyenne });
ecrireBinaire(join(SORTIE, "graphe.bin"), { offsets: graphe.offsets, cibles: graphe.cibles, types: graphe.types, poids: graphe.poids }, { noeuds: { R, C, M, L, K } });
const triesFinal = empreintesTriees();
ecrireBinaire(join(SORTIE, "empreintes.bin"), { empreintes: triesFinal });

// ── 7. Vecteurs e5 (« passage: »), quantifiés en int8 avec une échelle par vecteur ───────────────────────────────────
// Cache local (data/cache/) par empreinte du texte : une reconstruction ne réencode que les passages modifiés.
if (!sansVecteurs) {
  const { vecteurs } = await import("../src/modeles/modeles.js");
  const { lireBinaire } = await import("../src/index/binaire.js");
  const D = passages.length;
  const q = new Int8Array(D * DIMENSION);
  const echelles = new Float32Array(D);
  const empreinte = (t: string) => createHash("sha1").update(nomModele(VECTEURS) + "\n" + t).digest("hex").slice(0, 16);
  const cles = textesVecteurs.map(empreinte);
  const fichierCache = join(RACINE, "data/cache/vecteurs.bin");
  const connus = new Map<string, number>();
  let cache: { vecteurs: Int8Array; echelles: Float32Array } | null = null;
  try {
    const c = lireBinaire(fichierCache);
    cache = { vecteurs: c.tableaux.vecteurs as Int8Array, echelles: c.tableaux.echelles as Float32Array };
    (c.meta.cles as string[]).forEach((k, i) => connus.set(k, i));
  } catch {
    // Reprise unique d'un index déjà encodé dans le même ordre (--reprendre-vecteurs).
    if (process.argv.includes("--reprendre-vecteurs")) {
      const v = lireBinaire(join(SORTIE, "vecteurs.bin"));
      if ((v.tableaux.echelles as Float32Array).length === D) {
        cache = { vecteurs: v.tableaux.vecteurs as Int8Array, echelles: v.tableaux.echelles as Float32Array };
        cles.forEach((k, i) => connus.set(k, i));
      }
    }
  }
  const aFaire: number[] = [];
  cles.forEach((k, i) => {
    const j = connus.get(k);
    if (cache && j !== undefined) {
      q.set(cache.vecteurs.subarray(j * DIMENSION, (j + 1) * DIMENSION), i * DIMENSION);
      echelles[i] = cache.echelles[j];
    } else aFaire.push(i);
  });
  console.log(`  vecteurs : ${D - aFaire.length} repris du cache, ${aFaire.length} à encoder`);
  const LOT = 32;
  const tv = Date.now();
  for (let a = 0; a < aFaire.length; a += LOT) {
    const ids = aFaire.slice(a, a + LOT);
    const lot = await vecteurs(ids.map((i) => textesVecteurs[i]), "passage: ");
    lot.forEach((v, j) => {
      const i = ids[j];
      let max = 1e-9;
      for (const x of v) max = Math.max(max, Math.abs(x));
      const s = max / 127;
      echelles[i] = s;
      for (let d = 0; d < DIMENSION; d++) q[i * DIMENSION + d] = Math.round(v[d] / s);
    });
    if ((a / LOT) % 50 === 0) process.stdout.write(`\r  vecteurs ${a + ids.length}/${aFaire.length} (${((Date.now() - tv) / 1000).toFixed(0)} s)`);
  }
  if (aFaire.length) process.stdout.write("\n");
  ecrireBinaire(join(SORTIE, "vecteurs.bin"), { vecteurs: q, echelles }, { dimension: DIMENSION, modele: nomModele(VECTEURS) });
  mkdirSync(join(RACINE, "data/cache"), { recursive: true });
  ecrireBinaire(fichierCache, { vecteurs: q, echelles }, { cles });
}

// ── 8. Manifeste ─────────────────────────────────────────────────────────────────────────────────────────────────
const fichiers: Manifeste["fichiers"] = {};
for (const f of ["ontologie.json", "passages.json", "bm25-termes.json", "bm25.bin", "graphe.bin", "empreintes.bin", ...(sansVecteurs ? [] : ["vecteurs.bin"])]) {
  const buf = readFileSync(join(SORTIE, f));
  fichiers[f] = { octets: statSync(join(SORTIE, f)).size, sha256: createHash("sha256").update(buf).digest("hex") };
}
const actifs = passages.filter((p) => !(p.f & DRAPEAU.retire));
const mots = actifs.map((p) => nombreDeMots(p.t));
const manifeste: Manifeste = {
  version: 1,
  construitLe: new Date().toISOString(),
  exporteLe: ex.exporteLe,
  comptes: { rubriques: R, cours: C, modules: M, lecons: nbLeconsPubliees, leconsRetirees: L - nbLeconsPubliees, passages: actifs.length, concepts: K, aretes: nbAretes(graphe), termes: vocab.length, empreintes: triesFinal.length },
  decoupe: { min: MIN, max: MAX, dansLaFourchette: Number((mots.filter((w) => w >= MIN && w <= MAX).length / Math.max(1, mots.length)).toFixed(3)), motsMoyens: Math.round(mots.reduce((s, w) => s + w, 0) / Math.max(1, mots.length)) },
  bm25: { k1: bm25.k1, b: bm25.b, longueurMoyenne: Number(bm25.moyenne.toFixed(1)) },
  modeles: { vecteurs: nomModele(VECTEURS) },
  fichiers,
  dureeMs: Date.now() - t0,
};
writeFileSync(join(SORTIE, "manifeste.json"), JSON.stringify(manifeste, null, 2));
console.log(
  `Index construit en ${(manifeste.dureeMs / 1000).toFixed(1)} s : ${manifeste.comptes.lecons} leçons (${manifeste.comptes.leconsRetirees} retirées), ${manifeste.comptes.passages} passages ` +
    `(${(manifeste.decoupe.dansLaFourchette * 100).toFixed(1)} % entre ${MIN} et ${MAX} mots, ${manifeste.decoupe.motsMoyens} en moyenne), ${K} concepts, ${manifeste.comptes.aretes} arêtes, ${vocab.length} termes.`,
);
