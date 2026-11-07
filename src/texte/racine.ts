// Racinisation légère du français (dans l'esprit du « light stemmer » de J. Savoy) appliquée à des mots déjà pliés
// (minuscules, sans accents). Elle rapproche pluriel, féminin, infinitif et quelques suffixes de nom d'action, sans viser
// la précision linguistique : filtrer, filtre, filtres, filtrage → « filtr » ; jointure, jointures → « jointur ».

const SUFFIXES: [string, string][] = [
  ["issements", ""],
  ["issement", ""],
  ["ations", ""],
  ["ation", ""],
  ["ements", ""],
  ["ement", ""],
  ["atrices", ""],
  ["atrice", ""],
  ["ateurs", ""],
  ["ateur", ""],
  ["ages", ""],
  ["age", ""],
  ["eraient", ""],
  ["erions", ""],
  ["eront", ""],
  ["erait", ""],
  ["erons", ""],
  ["erez", ""],
  ["ees", ""],
  ["ee", ""],
  ["er", ""],
  ["ez", ""],
];

export function racine(mot: string): string {
  let m = mot;
  if (m.length <= 3 || /\d/.test(m) || m.includes("_")) return m;
  // Pluriels : chevaux → cheval, réseaux → réseau, tables → table.
  if (m.endsWith("eaux")) m = m.slice(0, -1);
  else if (m.endsWith("aux") && m.length > 4) m = m.slice(0, -3) + "al";
  else if ((m.endsWith("s") && !m.endsWith("ss")) || m.endsWith("x")) m = m.slice(0, -1);
  for (const [suf, rep] of SUFFIXES) {
    if (m.endsWith(suf) && m.length - suf.length >= 4) {
      m = m.slice(0, -suf.length) + rep;
      break;
    }
  }
  if (m.endsWith("e") && m.length > 4) m = m.slice(0, -1);
  return m;
}
