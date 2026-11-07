// Empreintes de code : fragments de 6 jetons consécutifs, hachés (FNV-1a 32 bits). Irréversibles, elles servent à
// reconnaître qu'un passage ou une réponse recopie une solution d'exercice sans jamais stocker la solution elle-même.

const TAILLE = 6;

/** Jetons de code normalisés : commentaires retirés, minuscules, identifiants, nombres et opérateurs. */
export function jetonsCode(code: string): string[] {
  const sans = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)(#|--|\/\/)[^\n]*/g, " ")
    .toLowerCase();
  return sans.match(/[a-z_][a-z0-9_]*|\d+(?:\.\d+)?|'[^']*'|"[^"]*"|==|!=|<=|>=|[^\s\w]/g) ?? [];
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function empreintesCode(code: string): number[] {
  const j = jetonsCode(code);
  if (j.length < 3) return [];
  if (j.length < TAILLE) return [fnv1a(j.join(" "))];
  const out: number[] = [];
  for (let i = 0; i + TAILLE <= j.length; i++) out.push(fnv1a(j.slice(i, i + TAILLE).join(" ")));
  return out;
}

/** Part des fragments d'un code présents dans un ensemble d'empreintes triées (recherche dichotomique). */
export function recouvrement(code: string, triees: Uint32Array): { communs: number; total: number } {
  const e = empreintesCode(code);
  let communs = 0;
  for (const h of e) {
    let lo = 0;
    let hi = triees.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (triees[mid] === h) {
        communs++;
        break;
      }
      if (triees[mid] < h) lo = mid + 1;
      else hi = mid - 1;
    }
  }
  return { communs, total: e.length };
}
