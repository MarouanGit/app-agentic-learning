// BM25 (Okapi) sur listes inversées compactes : termes → [documents, fréquences], en tableaux typés.
// Construction hors ligne (scripts/construire.ts) et recherche au runtime (agent lexical de l'ancrage hybride).

export type IndexBM25 = {
  termes: Map<string, number>;
  offsets: Uint32Array; // V + 1
  docs: Uint32Array; // P
  tfs: Uint16Array; // P
  longueurs: Uint16Array; // D
  moyenne: number;
  k1: number;
  b: number;
};

export function construireBM25(documents: string[][], k1 = 1.2, b = 0.75) {
  const vocab = new Map<string, number>();
  const listes: [number, number][][] = [];
  const longueurs = new Uint16Array(documents.length);
  let somme = 0;
  documents.forEach((termes, d) => {
    longueurs[d] = Math.min(termes.length, 65535);
    somme += termes.length;
    const tf = new Map<string, number>();
    for (const t of termes) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) {
      let id = vocab.get(t);
      if (id === undefined) {
        id = vocab.size;
        vocab.set(t, id);
        listes.push([]);
      }
      listes[id].push([d, Math.min(n, 65535)]);
    }
  });
  const offsets = new Uint32Array(vocab.size + 1);
  let p = 0;
  listes.forEach((l, i) => {
    offsets[i] = p;
    p += l.length;
  });
  offsets[vocab.size] = p;
  const docs = new Uint32Array(p);
  const tfs = new Uint16Array(p);
  listes.forEach((l, i) => l.forEach(([d, n], j) => ((docs[offsets[i] + j] = d), (tfs[offsets[i] + j] = n))));
  const index: IndexBM25 = { termes: vocab, offsets, docs, tfs, longueurs, moyenne: documents.length ? somme / documents.length : 0, k1, b };
  return index;
}

export const df = (ix: IndexBM25, id: number) => ix.offsets[id + 1] - ix.offsets[id];

export function idf(ix: IndexBM25, terme: string): number {
  const id = ix.termes.get(terme);
  if (id === undefined) return 0;
  const n = df(ix, id);
  const N = ix.longueurs.length;
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

export type Resultat = { doc: number; score: number };

let tampon: Float32Array | null = null;

/** Les k meilleurs documents pour une requête pondérée ; `admis(doc)` filtre (cours autorisés, retraits). */
export function chercherBM25(ix: IndexBM25, requete: { terme: string; poids: number }[], k = 50, admis?: (doc: number) => boolean): Resultat[] {
  const N = ix.longueurs.length;
  if (!tampon || tampon.length < N) tampon = new Float32Array(N);
  const scores = tampon;
  const touches: number[] = [];
  const vus = new Set<string>();
  for (const { terme, poids } of requete) {
    if (vus.has(terme)) continue;
    vus.add(terme);
    const id = ix.termes.get(terme);
    if (id === undefined) continue;
    const w = idf(ix, terme) * poids;
    for (let p = ix.offsets[id]; p < ix.offsets[id + 1]; p++) {
      const d = ix.docs[p];
      const tf = ix.tfs[p];
      const norme = ix.k1 * (1 - ix.b + (ix.b * ix.longueurs[d]) / (ix.moyenne || 1));
      if (scores[d] === 0) touches.push(d);
      scores[d] += (w * (tf * (ix.k1 + 1))) / (tf + norme);
    }
  }
  const res: Resultat[] = [];
  for (const d of touches) {
    if (!admis || admis(d)) res.push({ doc: d, score: scores[d] });
    scores[d] = 0;
  }
  res.sort((a, b) => b.score - a.score || a.doc - b.doc);
  return res.slice(0, k);
}
