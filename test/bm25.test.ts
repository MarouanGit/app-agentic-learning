import assert from "node:assert/strict";
import { test } from "node:test";
import { chercherBM25, construireBM25, df, idf } from "../src/moteur/bm25.js";
import { termes } from "../src/texte/normaliser.js";
import { racine } from "../src/texte/racine.js";
import { expansion } from "../src/texte/synonymes.js";

const corpus = [
  "Une jointure combine deux tables : INNER JOIN garde les lignes qui correspondent.",
  "GROUP BY regroupe les lignes et calcule une somme par groupe.",
  "Une liste Python se crée avec des crochets ; append ajoute un élément.",
  "Les jointures externes (LEFT JOIN) gardent toutes les lignes de gauche.",
];
const ix = construireBM25(corpus.map(termes));
const q = (s: string) => termes(s).map((terme) => ({ terme, poids: 1 }));

test("racinisation légère : pluriel, féminin, infinitif, nom d'action", () => {
  for (const m of ["filtrer", "filtre", "filtres", "filtrage"]) assert.equal(racine(m), "filtr");
  assert.equal(racine("jointures"), racine("jointure"));
  assert.equal(racine("donnees"), racine("donnee"));
  assert.equal(racine("tableaux"), "tableau");
  assert.equal(racine("class"), "class"); // « ss » final conservé
  assert.equal(racine("sql"), "sql"); // mots courts intacts
});

test("termes : accents pliés, mots vides retirés, identifiants découpés", () => {
  assert.deepEqual(termes("Les données de la table"), ["donn", "tabl"]);
  assert.ok(termes("df.groupby('client')").includes("groupby"));
  assert.ok(termes("drop_duplicates").includes("drop_duplicates"));
  assert.ok(termes("drop_duplicates").includes("duplicat"));
});

test("listes inversées : offsets, fréquences et longueurs cohérents", () => {
  assert.equal(ix.longueurs.length, corpus.length);
  assert.equal(ix.offsets[ix.termes.size], ix.docs.length);
  const id = ix.termes.get(racine("lignes"))!;
  assert.equal(df(ix, id), 3);
  assert.ok(idf(ix, racine("append")) > idf(ix, racine("lignes")), "un terme rare pèse plus qu'un terme fréquent");
  assert.equal(idf(ix, "inconnu"), 0);
});

test("recherche : le document pertinent sort premier, pluriel et singulier se rejoignent", () => {
  const r = chercherBM25(ix, q("les jointures"), 10);
  assert.ok([0, 3].includes(r[0].doc));
  assert.equal(chercherBM25(ix, q("ajouter avec append"), 10)[0].doc, 2);
  assert.equal(chercherBM25(ix, q("GROUP BY somme"), 10)[0].doc, 1);
});

test("recherche : k, filtre d'admission, requête vide, poids", () => {
  assert.equal(chercherBM25(ix, q("lignes"), 2).length, 2);
  const filtre = chercherBM25(ix, q("jointure"), 10, (d) => d !== 0);
  assert.ok(filtre.every((x) => x.doc !== 0));
  assert.deepEqual(chercherBM25(ix, [], 10), []);
  const leger = chercherBM25(ix, [{ terme: racine("append"), poids: 0.5 }], 1)[0].score;
  const plein = chercherBM25(ix, [{ terme: racine("append"), poids: 1 }], 1)[0].score;
  assert.ok(Math.abs(plein - 2 * leger) < 1e-5);
  // Deux recherches successives : le tampon des scores est bien remis à zéro.
  assert.deepEqual(chercherBM25(ix, q("append"), 10), chercherBM25(ix, q("append"), 10));
});

test("synonymes : la requête « join » s'élargit vers « jointure »", () => {
  assert.ok(expansion(termes("join")).includes(racine("jointure")));
  assert.ok(expansion(termes("valeurs manquantes")).some((t) => t === "nan" || t === "null"));
});
