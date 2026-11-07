// Identifiants utiles d'un code d'apprenant (fonctions, méthodes, mots-clés SQL), en termes d'index.
import { termes } from "../texte/normaliser.js";

const BANALS = new Set(["print", "len", "str", "int", "float", "range", "list", "dict", "set", "type", "self", "return", "true", "false", "none", "null"]);

export function identifiantsDuCode(code: string): string[] {
  const ids = new Set<string>();
  for (const m of code.slice(0, 4000).matchAll(/(?:\.|\b)([A-Za-z_][A-Za-z0-9_]{2,})\s*\(/g)) if (!BANALS.has(m[1].toLowerCase())) ids.add(m[1]);
  for (const m of code.matchAll(/\b(SELECT|GROUP BY|ORDER BY|HAVING|JOIN|LEFT JOIN|INNER JOIN|UNION|DISTINCT|WITH|OVER|PARTITION BY|CASE|COALESCE|WHERE|LIMIT)\b/gi)) ids.add(m[1]);
  for (const m of code.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][\w]*)/gm)) ids.add(m[1]);
  return [...new Set([...ids].flatMap((s) => termes(s)))].slice(0, 20);
}
