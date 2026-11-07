import assert from "node:assert/strict";
import { test } from "node:test";
import { ancrer } from "../src/moteur/ancrage.js";
import { ponderer } from "../src/moteur/appui.js";
import { leconsAtteintes, lierConcepts } from "../src/moteur/concepts.js";
import { evaluerPortes, PORTES, premiereFermee } from "../src/moteur/portes.js";
import { EntreeInvalide, prendreEnCharge, validerDemande, type Demande } from "../src/moteur/priseEnCharge.js";
import { repondre } from "../src/moteur/repondre.js";
import { classer } from "../src/moteur/tri.js";
import { verifier } from "../src/moteur/verification.js";
import { fixture, moteursFactices } from "./fixture.js";

const ix = fixture();
const tous = (question: string, extra: Partial<Demande> = {}): Demande => ({ question, mode: "aide", autorises: "tous", ...extra });

async function portes(d: Demande) {
  const r = prendreEnCharge(d, ix);
  const ancrage = await ancrer(ix, r, async () => null);
  const lies = lierConcepts(ix, r);
  const classes = classer(ix, ancrage.candidats, ponderer(ix, r), leconsAtteintes(ix, lies).distances);
  const res = await evaluerPortes({ ix, r, ancrage, lies, classes });
  return { res, fermee: premiereFermee(res) };
}

test("les 6 portes ont un code et un message en français", () => {
  assert.deepEqual(PORTES.map((p) => p.code), ["aucune-entree", "trop-vague", "hors-programme", "non-citable", "retire", "non-verifie"]);
  for (const p of PORTES) assert.ok(p.message.length > 40 && /[éèàç]/.test(p.message));
});

test("question dans le programme : les cinq portes s'ouvrent, chacune mesurée", async () => {
  const { res, fermee } = await portes(tous("Quelle différence entre INNER JOIN et LEFT JOIN ?"));
  assert.equal(fermee, null);
  assert.deepEqual(res.map((p) => p.n), [1, 2, 3, 4, 5]);
  assert.ok(res.every((p) => p.ok && typeof p.ms === "number"));
});

test("porte 1 · aucune-entree : vide, mots inconnus, aucun cours autorisé", async () => {
  assert.equal((await portes(tous("   ?! "))).fermee?.code, "aucune-entree");
  assert.equal((await portes(tous("Quelle est la capitale de l'Australie ?"))).fermee?.code, "aucune-entree");
  assert.equal((await portes({ question: "LEFT JOIN ?", mode: "aide", autorises: [] })).fermee?.code, "aucune-entree");
});

test("porte 2 · trop-vague : formule creuse sans contexte ; acceptée depuis une leçon", async () => {
  assert.equal((await portes(tous("je comprends pas"))).fermee?.code, "trop-vague");
  const depuisLecon = await portes(tous("je comprends pas", { lecon: "sql-join", cours: "apprendre-sql" }));
  assert.notEqual(depuisLecon.fermee?.code, "trop-vague");
});

test("porte 3 · hors-programme : aucun chemin vers un cours autorisé", async () => {
  const { fermee } = await portes({ question: "Comment ajouter un élément avec append à une liste Python ?", mode: "aide", autorises: ["apprendre-sql"] });
  assert.ok(fermee && fermee.n <= 3, `fermée à ${fermee?.code}`);
  const ouvert = await portes({ question: "Comment ajouter un élément avec append à une liste Python ?", mode: "aide", autorises: ["apprendre-python"] });
  assert.equal(ouvert.fermee, null);
});

test("porte 5 · retire : la seule leçon qui répond n'est plus publiée", async () => {
  const { fermee } = await portes(tous("Les vues matérialisées"));
  assert.equal(fermee?.code, "retire");
  const depuisRetiree = await portes(tous("Quelle différence entre INNER JOIN et LEFT JOIN ?", { lecon: "sql-vues" }));
  assert.equal(depuisRetiree.fermee?.code, "retire");
});

test("porte 6 · non-verifie : une phrase sans appui fait échouer la vérification", async () => {
  const pjoin = 0;
  const ok = await verifier(ix, "LEFT JOIN garde toutes les lignes de la table de gauche [1].", [pjoin]);
  assert.ok(ok.ok);
  const ko = await verifier(ix, "LEFT JOIN garde toutes les lignes de gauche [1]. Le football se joue à onze joueurs sur un terrain gazonné [1].", [pjoin]);
  assert.ok(!ko.ok);
  assert.equal(ko.phrases.filter((p) => !p.ok).length, 1);
});

test("porte 6 corrige une citation mal placée vers le passage qui appuie la phrase", async () => {
  const v = await verifier(ix, "La méthode append ajoute un élément à la fin de la liste [1].", [0, 2]);
  assert.ok(v.ok);
  assert.match(v.texte, /\[2\]\.$/);
});

test("repondre : réponse rédigée, citations validées et renumérotées, URL du cours autorisé", async () => {
  const r = await repondre(tous("Quelle différence entre INNER JOIN et LEFT JOIN ?", { cours: "apprendre-sql" }), moteursFactices("INNER JOIN ne garde que les lignes qui correspondent dans les deux tables [1]. LEFT JOIN garde toutes les lignes de la table de gauche [1] [9]."));
  assert.equal(r.statut, "reponse");
  assert.equal(r.citations.length, 1);
  assert.deepEqual(r.citations[0], { ...r.citations[0], n: 1, cours: "apprendre-sql", lecon: "sql-join", url: "/cours/apprendre-sql/sql-join" });
  assert.ok(r.citations[0].extrait.length <= 280);
  assert.ok(!r.texte.includes("[9]"));
  assert.deepEqual(r.trace.portes.map((p) => p.n), [1, 2, 3, 4, 5, 6]);
});

test("repondre : rédaction non vérifiable → réponse extractive citée", async () => {
  const r = await repondre(tous("Quelle différence entre INNER JOIN et LEFT JOIN ?"), moteursFactices("Les jointures ont été inventées en 1974 par un comité de normalisation lunaire [1]."));
  assert.equal(r.statut, "reponse");
  assert.equal(r.trace.modele, "extractif");
  assert.ok(r.trace.portes.find((p) => p.n === 6)?.ok === false);
  assert.ok(r.citations.length >= 1 && /\[1\]/.test(r.texte));
});

test("repondre : refus motivé (porte, code, message) sans citation", async () => {
  const r = await repondre(tous("Quelle est la capitale de l'Australie ?"), moteursFactices(""));
  assert.equal(r.statut, "refus");
  assert.equal(r.refus?.porte, 1);
  assert.equal(r.texte, r.refus?.message);
  assert.deepEqual(r.citations, []);
});

test("validation de l'entrée : tailles et types du contrat", () => {
  assert.throws(() => validerDemande({ question: "x".repeat(501), mode: "aide", autorises: "tous" }), EntreeInvalide);
  assert.throws(() => validerDemande({ question: "ok", mode: "solution", autorises: "tous" }), EntreeInvalide);
  assert.throws(() => validerDemande({ question: "ok", mode: "aide" }), EntreeInvalide, "autorises est obligatoire");
  assert.throws(() => validerDemande({ question: "ok", mode: "aide", autorises: "tous", code: "x".repeat(4001) }), EntreeInvalide);
  assert.equal(validerDemande({ question: "ok", autorises: ["apprendre-sql"] }).mode, "aide");
});
