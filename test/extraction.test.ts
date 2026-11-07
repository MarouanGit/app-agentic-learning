import assert from "node:assert/strict";
import { test } from "node:test";
import { empreintesCode, recouvrement } from "../src/texte/empreintes.js";
import { retirerCode, borner } from "../src/moteur/redaction.js";
import { extraireBlocs, texteWidget } from "../scripts/lib/extraction.js";

const code = (language: string, donnees: unknown) => ({ type: "codeBlock", props: { language }, content: [{ type: "text", text: typeof donnees === "string" ? donnees : JSON.stringify(donnees), styles: {} }] });
const para = (text: string, styles = {}) => ({ type: "paragraph", content: [{ type: "text", text, styles }] });

test("BlockNote : titres en chemin, gras et code en ligne repérés, code conservé", () => {
  const x = extraireBlocs([
    { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Les jointures", styles: {} }] },
    { type: "paragraph", content: [{ type: "text", text: "Une ", styles: {} }, { type: "text", text: "jointure", styles: { bold: true } }, { type: "text", text: " relie deux tables avec ", styles: {} }, { type: "text", text: "JOIN", styles: { code: true } }] },
    code("sql", "SELECT * FROM a JOIN b ON a.id = b.id;"),
  ]);
  assert.deepEqual(x.segments[0].titres, ["Les jointures"]);
  assert.ok(x.gras.includes("jointure"));
  assert.ok(x.codeEnLigne.includes("JOIN"));
  assert.ok(x.segments.some((s) => s.code && s.texte.startsWith("SELECT")));
});

test("composants d'évaluation : la question reste, les réponses et corrigés disparaissent", () => {
  const x = extraireBlocs([
    code("exercices", { titre: "Entraînement", exercices: [{ id: "e1", titre: "Somme", text: "Que renvoie sum([1, 2]) ?", answer: "3", indice: "additionne", explanation: "1 + 2 = 3", options: [{ id: "a", text: "3", correct: true }] }] }),
    code("prediction", { titre: "Pari", question: "Combien de lignes ?", reponse: 42, revelation: "Il y en a 42 car…" }),
    code("decision", { titre: "Cas", situation: "Une banque…", question: "Que faites-vous ?", choix: [{ texte: "ETL", retour: "Bonne réponse", ton: "bon" }] }),
    code("challenge", { titre: "Défi", mission: "Analyser les ventes", etapes: [{ titre: "Étape 1", consigne: "Calculez le CA", corrige: "CA = 1 200 €", solution: "SELECT SUM(ca)", indices: ["pensez à SUM"], fautes: [{ reponse: "x", message: "y" }] }] }),
    code("reflexion", { question: "Pourquoi ?", piste: "Parce que la réponse est X" }),
    code("python-solution", "print(sum([1, 2]))"),
    code("lab-etape", { titre: "Ouvrir", action: "Clique sur Fichier", attendu: "Le menu s'ouvre", verif: { question: "Q ?", bonne: 1, explication: "car" } }),
  ]);
  const tout = x.segments.map((s) => s.texte).join(" ");
  for (const present of ["Que renvoie sum([1, 2]) ?", "Combien de lignes ?", "Une banque", "Calculez le CA", "Pourquoi ?", "Clique sur Fichier", "On doit voir : Le menu s'ouvre".slice(3)]) assert.ok(tout.includes(present), present);
  for (const absent of ["additionne", "1 + 2 = 3", "42", "Bonne réponse", "1 200", "SELECT SUM", "pensez à SUM", "Parce que la réponse", "print(sum", "car"]) assert.ok(!tout.includes(absent), `fuite : ${absent}`);
  assert.ok(x.solutions.some((s) => s.includes("SELECT SUM")), "les corrigés sont gardés à part pour leurs empreintes");
});

test("dépannage de lab : la « solution » d'un symptôme technique est gardée (exception documentée)", () => {
  const t = texteWidget("lab-depannage", { problemes: [{ symptome: "Erreur 401", solution: "Régénère la clé" }] }, { segments: [], gras: [], codeEnLigne: [], identifiants: [], solutions: [] });
  assert.ok(t.join(" ").includes("Régénère la clé"));
});

test("empreintes : un code recopié est reconnu, un autre code non", () => {
  const sol = "WITH moy AS (SELECT categorie, AVG(prix) AS m FROM produits GROUP BY categorie) SELECT p.nom FROM produits p JOIN moy ON p.categorie = moy.categorie";
  const e = Uint32Array.from(empreintesCode(sol).sort((a, b) => a - b));
  const copie = recouvrement("-- ma réponse\n" + sol.toLowerCase(), e);
  assert.ok(copie.communs / copie.total > 0.9);
  const autre = recouvrement("SELECT nom, prenom FROM clients WHERE ville = 'Lyon' ORDER BY nom", e);
  assert.ok(autre.communs / Math.max(1, autre.total) < 0.2);
});

test("mode indice : blocs et lignes de code retirés ; 120 mots au plus", () => {
  const t = retirerCode("Pense à regrouper les lignes [1].\n```sql\nSELECT client, SUM(x) FROM v GROUP BY client;\n```\nSELECT * FROM t;\nRegarde la leçon sur GROUP BY [1].", new Uint32Array(0));
  assert.ok(!/SELECT/.test(t));
  assert.ok(t.includes("Regarde la leçon"));
  const long = Array.from({ length: 30 }, (_, i) => `Phrase numéro ${i} assez courte.`).join(" ");
  assert.ok(borner(long).split(/\s+/).length <= 120);
});
