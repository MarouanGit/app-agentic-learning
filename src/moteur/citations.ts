// Validation des citations [n] d'un texte rédigé : formes normalisées ([1, 2] → [1][2], [Passage 3] → [3]), numéros
// hors des passages fournis supprimés, renumérotation dans l'ordre d'apparition, doublons consécutifs retirés.

export function normaliserCitations(texte: string): string {
  return texte
    .replace(/\[\s*(?:passage|source|réf\.?|ref\.?|extrait)\s*(\d+)\s*\]/gi, "[$1]")
    .replace(/\[(\d+(?:\s*[,;]\s*\d+)+)\]/g, (_, l: string) => l.split(/[,;]/).map((n) => `[${n.trim()}]`).join(""))
    .replace(/\[(\d+)\s*[-–]\s*(\d+)\]/g, (m, a: string, b: string) => {
      const [x, y] = [Number(a), Number(b)];
      return y >= x && y - x < 10 ? Array.from({ length: y - x + 1 }, (_, i) => `[${x + i}]`).join("") : m;
    });
}

export type Validation = { texte: string; ordre: number[]; invalides: number };

/** `k` passages fournis (numérotés 1..k). `ordre[i]` : numéro d'origine du passage devenu [i + 1]. */
export function validerCitations(brut: string, k: number): Validation {
  const texte0 = normaliserCitations(brut);
  const ordre: number[] = [];
  let invalides = 0;
  const texte1 = texte0.replace(/\[(\d+)\]/g, (_, s: string) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1 || n > k) {
      invalides++;
      return "";
    }
    let i = ordre.indexOf(n);
    if (i < 0) i = ordre.push(n) - 1;
    return `[${i + 1}]`;
  });
  const texte = texte1
    .replace(/(\[\d+\])(\s*\1)+/g, "$1")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { texte, ordre, invalides };
}

/** Numéros cités dans une phrase. */
export const citesDans = (phrase: string) => [...phrase.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
export const sansCitations = (phrase: string) => phrase.replace(/\s*\[\d+\]/g, "").trim();

/** Vérifie qu'un texte final ne cite que des numéros de 1 à n, chacun présent dans la liste des citations. */
export function citationsCoherentes(texte: string, n: number): boolean {
  const cites = citesDans(texte);
  return cites.every((x) => x >= 1 && x <= n) && Array.from({ length: n }, (_, i) => i + 1).every((x) => cites.includes(x));
}
