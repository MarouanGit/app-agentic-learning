import assert from "node:assert/strict";
import { test } from "node:test";
import { bfs, chemin, Chemins, construireCSR, type Arete } from "../src/moteur/csr.js";
import { LRU } from "../src/moteur/lru.js";

// 0 → 1 → 2 → 3 → 4 (type 0), 0 → 5 (type 1)
const aretes: Arete[] = [
  { de: 0, vers: 1, type: 0, poids: 1 },
  { de: 1, vers: 2, type: 0, poids: 1 },
  { de: 2, vers: 3, type: 0, poids: 1 },
  { de: 3, vers: 4, type: 0, poids: 1 },
  { de: 0, vers: 5, type: 1, poids: 0.5 },
];
const g = construireCSR(6, aretes);

test("CSR : offsets et voisins", () => {
  assert.deepEqual([...g.offsets], [0, 2, 3, 4, 5, 5, 5]);
  const voisins0 = [...g.cibles.slice(g.offsets[0], g.offsets[1])].sort();
  assert.deepEqual(voisins0, [1, 5]);
  assert.equal(g.poids[g.offsets[0] + [...g.cibles.slice(0, 2)].indexOf(5)], 0.5);
});

test("BFS : 2 sauts au plus, même si on en demande plus", () => {
  const r = bfs(g, [0], new Set([0, 1]), 5);
  assert.deepEqual([...r.keys()].sort(), [0, 1, 2, 5]);
  assert.equal(r.get(2)!.distance, 2);
  assert.ok(!r.has(3), "le troisième saut n'est jamais franchi");
});

test("BFS : types d'arêtes suivis, plusieurs graines, chemin reconstitué", () => {
  const r = bfs(g, [0], new Set([1]), 2);
  assert.deepEqual([...r.keys()].sort(), [0, 5]);
  const r2 = bfs(g, [0, 3], new Set([0]), 1);
  assert.deepEqual([...r2.keys()].sort(), [0, 1, 3, 4]);
  const r3 = bfs(g, [0], new Set([0]), 2);
  assert.deepEqual(chemin(r3, 2), [0, 1, 2]);
});

test("cache des chemins : même ensemble de graines (ordre indifférent) servi par le cache", () => {
  const c = new Chemins(g, new Set([0, 1]), 10);
  const a = c.depuis([0, 2]);
  const b = c.depuis([2, 0]);
  assert.equal(a, b);
  assert.equal(c.cache.succes, 1);
});

test("LRU : éviction du moins récemment utilisé", () => {
  const l = new LRU<string, number>(2);
  l.set("a", 1);
  l.set("b", 2);
  l.get("a");
  l.set("c", 3);
  assert.equal(l.get("b"), undefined);
  assert.equal(l.get("a"), 1);
  assert.equal(l.taille, 2);
});
