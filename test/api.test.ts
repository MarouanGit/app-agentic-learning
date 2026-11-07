import assert from "node:assert/strict";
import { test } from "node:test";
import { autorise, lireJson, CorpsTropGros } from "../src/http.js";
import { completer, finCompletion, nettoyerSuggestion, validerCompletion } from "../src/moteur/completer.js";
import { EntreeInvalide } from "../src/moteur/priseEnCharge.js";

const SECRET = "a".repeat(64);
const req = (auth?: string, body?: string) => new Request("http://x/api/ask", { method: "POST", headers: auth ? { authorization: auth } : {}, body });

test("secret : Bearer exact accepté, tout le reste refusé, secret absent = tout refusé", () => {
  assert.ok(autorise(req(`Bearer ${SECRET}`), SECRET));
  assert.ok(!autorise(req(`Bearer ${SECRET}x`), SECRET));
  assert.ok(!autorise(req(`Bearer ${"b".repeat(64)}`), SECRET));
  assert.ok(!autorise(req(SECRET), SECRET));
  assert.ok(!autorise(req(), SECRET));
  assert.ok(!autorise(req(`Bearer ${SECRET}`), undefined));
  assert.ok(!autorise(req("Bearer court"), "court"), "un secret de moins de 32 caractères n'est jamais accepté");
});

test("corps : JSON lu, taille bornée", async () => {
  assert.deepEqual(await lireJson(req(undefined, '{"a":1}'), 100), { a: 1 });
  await assert.rejects(lireJson(req(undefined, JSON.stringify({ q: "x".repeat(200) })), 100), CorpsTropGros);
  await assert.rejects(lireJson(req(undefined, "{pas du json"), 100), EntreeInvalide);
});

test("complete : validation des tailles du contrat", () => {
  assert.throws(() => validerCompletion({ langage: "python", avant: "x".repeat(2001) }), EntreeInvalide);
  assert.throws(() => validerCompletion({ langage: "python", avant: "", apres: "x".repeat(1001) }), EntreeInvalide);
  assert.equal(validerCompletion({ langage: "Python", avant: "a" }).langage, "python");
});

test("complete : arrêt à la ligne vide, recouvrement avec la suite, 200 caractères au plus", () => {
  assert.ok(finCompletion("return x\n\n"));
  assert.ok(!finCompletion("return x\n"));
  assert.equal(nettoyerSuggestion("return sum(n) / len(n)\n\nprint(1)", ""), "return sum(n) / len(n)");
  assert.equal(nettoyerSuggestion("total = a + b\nprint(total)", "print(total)\n"), "total = a + b");
  assert.ok(nettoyerSuggestion("x = 1\n".repeat(60), "").length <= 200);
  assert.equal(nettoyerSuggestion("a = 1<|endoftext|>bla", ""), "a = 1");
  assert.equal(nettoyerSuggestion("<|fim_middle|>self.titre = titre", ""), "self.titre = titre");
  assert.equal(nettoyerSuggestion('nom + " " + str(age))\nprint(nom)', ")\n"), 'nom + " " + str(age)', "curseur en milieu de ligne : une ligne, sans la suite");
  assert.equal(nettoyerSuggestion("# Compter\n# Compter\n# Compter", ""), "# Compter", "boucle de répétition coupée");
  assert.equal(nettoyerSuggestion("def f(a):\n        return a", "", "def f(a):\n    "), "return a", "ligne recopiée ignorée, pas de double indentation");
});

test("complete : suggestion vide passé 4 s, sans attendre le modèle", async () => {
  const lent = () => new Promise<{ texte: string; delaiDepasse: boolean }>((res) => setTimeout(() => res({ texte: "trop tard", delaiDepasse: false }), 6000).unref());
  const t0 = Date.now();
  const r = await completer({ langage: "python", avant: "def f():\n    ", apres: "" }, lent);
  assert.equal(r.suggestion, "");
  assert.ok(Date.now() - t0 < 4600);
  const rapide = await completer({ langage: "python", avant: "def f():\n    ", apres: "" }, async () => ({ texte: "return 1\n\n", delaiDepasse: false }));
  assert.equal(rapide.suggestion, "return 1");
});
