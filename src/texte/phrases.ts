// Découpe en phrases (français) : ponctuation finale suivie d'une majuscule, d'un chiffre ou d'un guillemet, et retours
// à la ligne. Les lignes de code restent des « phrases » à part.

export function phrases(texte: string): string[] {
  const out: string[] = [];
  for (const ligne of texte.split(/\n+/)) {
    const l = ligne.trim();
    if (!l) continue;
    for (const p of l.split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Ý0-9«"(\[])/u)) {
      const s = p.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Coupe un texte à `max` caractères sur une fin de mot, avec une ellipse. */
export function couper(texte: string, max: number): string {
  const t = texte.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max - 1);
  const i = c.lastIndexOf(" ");
  return (i > max * 0.6 ? c.slice(0, i) : c).replace(/[\s,;:.–-]+$/, "") + "…";
}
