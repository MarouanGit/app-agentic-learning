// Cache LRU minimal (Map conserve l'ordre d'insertion) : chemins du graphe, scores d'ancrage, vecteurs de requête.
export class LRU<K, V> {
  private m = new Map<K, V>();
  succes = 0;
  echecs = 0;
  constructor(private capacite: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v === undefined) {
      this.echecs++;
      return undefined;
    }
    this.succes++;
    this.m.delete(k);
    this.m.set(k, v);
    return v;
  }
  set(k: K, v: V) {
    if (this.m.has(k)) this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.capacite) this.m.delete(this.m.keys().next().value as K);
  }
  get taille() {
    return this.m.size;
  }
}
