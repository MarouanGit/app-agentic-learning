import assert from "node:assert/strict";
import { test } from "node:test";
import { citationsCoherentes, citesDans, normaliserCitations, sansCitations, validerCitations } from "../src/moteur/citations.js";

test("formes normalisées : listes, plages, « Passage n »", () => {
  assert.equal(normaliserCitations("A [1, 3]. B [2-4]. C [Passage 2]."), "A [1][3]. B [2][3][4]. C [2].");
});

test("numéros hors des passages supprimés, renumérotation dans l'ordre d'apparition", () => {
  const v = validerCitations("La jointure combine deux tables [3]. LEFT JOIN garde la gauche [7] [1]. Encore [3].", 4);
  assert.equal(v.texte, "La jointure combine deux tables [1]. LEFT JOIN garde la gauche [2]. Encore [1].");
  assert.deepEqual(v.ordre, [3, 1]);
  assert.equal(v.invalides, 1);
});

test("doublons consécutifs et espaces avant la ponctuation", () => {
  const v = validerCitations("Phrase [2][2] .", 2);
  assert.equal(v.texte, "Phrase [1].");
});

test("aucune citation valide : texte intact, ordre vide", () => {
  const v = validerCitations("Sans citation [0] ni [9].", 3);
  assert.equal(v.texte, "Sans citation ni.");
  assert.deepEqual(v.ordre, []);
});

test("cohérence finale : chaque citation existe et chaque passage listé est cité", () => {
  assert.ok(citationsCoherentes("A [1]. B [2].", 2));
  assert.ok(!citationsCoherentes("A [1]. B [3].", 2));
  assert.ok(!citationsCoherentes("A [1].", 2));
  assert.deepEqual(citesDans("x [1] y [12]"), [1, 12]);
  assert.equal(sansCitations("Une phrase [1][2]."), "Une phrase.");
});
