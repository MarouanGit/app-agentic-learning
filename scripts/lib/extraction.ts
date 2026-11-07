// Extraction du texte utile d'une leçon du LMS. Le contenu est un document BlockNote (paragraphes, titres, listes,
// tableaux, citations) dont les blocs de code portent soit du vrai code (python, sql…), soit un composant interactif
// en JSON (```etapes, ```decision, ```lab-etape…, le « Markdown à widgets » du LMS).
//
// Règle d'or : rien de ce qui révèle une solution, un corrigé ou une bonne réponse n'entre dans l'index
// (solution, corrige, bonne, correct, reponse, revelation, explication, retour, indices, piste, verif…).

export type Segment = {
  titres: string[]; // chemin de titres DANS la leçon (h1 › h2 › h3)
  texte: string;
  code: boolean; // segment de code (lignes conservées)
  langage?: string;
};
export type Extraction = { segments: Segment[]; gras: string[]; codeEnLigne: string[]; identifiants: string[]; solutions: string[] };

const LANGAGES_CODE = new Set([
  "python", "sql", "bash", "shell", "sh", "json", "yaml", "markdown", "dockerfile", "javascript", "js", "ts", "typescript", "html", "css",
  "dax", "http", "dbml", "csv", "toml", "hcl", "xml", "m", "r", "text", "plaintext", "powershell", "ini", "env",
]);
// Clés jamais indexées, à toute profondeur : réponses et corrigés, mais aussi la mise en forme (coordonnées, couleurs, images).
const CLES_INTERDITES = new Set([
  "solution", "solutions", "corrige", "corriges", "correction", "bonne", "bonnes", "correct", "reponse", "reponses", "answer", "answers",
  "revelation", "explication", "explanation", "retour", "retours", "fautes", "indices", "indice", "piste", "reussite", "validation", "verif",
  "controle", "check", "checkSource", "hint", "hints", "hintHtml", "hintMd", "tests", "expected", "condition", "formule", "bloqueePar", "arret",
  "casseePar", "pieges", "tolerance", "blanks", "pairs", "categories", "category", "multiple", "options", "choix", "skillMd", "zip", "cellules",
  "src", "url", "embed", "slug", "id", "x", "y", "l", "h", "largeur", "hauteur", "ton", "tons", "icone", "col", "ligne", "date", "version", "statut",
  "validite_jours", "date_validation", "verifie_le", "carte_bancaire", "decimales", "prefixe", "suffixe", "pas", "min", "max", "valeur", "xp",
  "xpParEtape", "niveaux", "badges", "labsXp", "filtre", "card", "trait", "sens", "forme", "etendue", "ecart", "entier", "credit", "source",
  "latex", "unite", "num", "lab", "kind", "type", "onglet", "points_", "requete", "requetes", "obtient", "budget", "mode", "fichier", "vue",
  "actifs", "eteints", "jusqua", "ici", "avis", "valeurs", "series", "axes", "quadrants", "debut", "duree", "secteur", "fonctions",
]);
// Composants d'évaluation : seules ces clés (question, consigne…) sont gardées, jamais les propositions ni les réponses.
const EVALUATIONS: Record<string, Set<string>> = {
  exercices: new Set(["titre", "exercices", "text"]),
  quiz: new Set(["titre", "questions", "text"]),
  prediction: new Set(["titre", "question"]),
  decision: new Set(["titre", "situation", "question"]),
  reflexion: new Set(["question"]),
  "attaque-defense": new Set(["titre", "consigne", "application", "nom", "protections", "description", "attaques", "owasp", "usages"]),
  trophees: new Set([]),
  notebook: new Set(["titre", "consigne", "objectif"]),
  "python-solution": new Set([]),
};
// Exceptions : dans un dépannage de lab, « solution » est la marche à suivre face à un symptôme technique, pas un corrigé.
const AUTORISEES: Record<string, Set<string>> = { "lab-depannage": new Set(["solution"]) };
// Préfixes qui disent au modèle ce qu'est un champ (ces champs sont affichés tels quels à l'apprenant dans la leçon).
const PREFIXES: Record<string, string> = { attendu: "À ce stade, on doit voir : ", sinon: "Si ce n'est pas le cas : ", symptome: "Symptôme : " };

const entites: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", rsquo: "’", laquo: "«", raquo: "»", hellip: "…", eacute: "é", egrave: "è", agrave: "à" };
export const decoderEntites = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return entites[e.toLowerCase()] ?? m;
  });

/** HTML (consignes de lab, exercices) → segments de texte et de code ; les <strong> donnent des termes en gras. */
export function htmlVersSegments(html: string, titres: string[], ex: Extraction) {
  const morceaux = html.split(/(<pre[\s\S]*?<\/pre>)/i);
  for (const m of morceaux) {
    if (/^<pre/i.test(m)) {
      const code = decoderEntites(m.replace(/<[^>]+>/g, "")).trim();
      if (code) {
        ex.segments.push({ titres, texte: code, code: true });
        ex.identifiants.push(...identifiantsCode(code));
      }
      continue;
    }
    for (const g of m.matchAll(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi)) ex.gras.push(decoderEntites(g[1].replace(/<[^>]+>/g, "")).trim());
    for (const c of m.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)) ex.codeEnLigne.push(decoderEntites(c[1].replace(/<[^>]+>/g, "")).trim());
    const texte = decoderEntites(
      m
        .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*/g, "\n")
      .trim();
    if (texte) ex.segments.push({ titres, texte, code: false });
  }
}

/** Identifiants de code utiles comme concepts : fonctions appelées, méthodes, mots-clés SQL et fonctions DAX. */
export function identifiantsCode(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:\.|\b)([A-Za-z_][A-Za-z0-9_]{2,})\s*\(/g)) out.add(m[1]);
  for (const m of code.matchAll(/\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|UNION|DISTINCT|LIMIT|WITH|CASE WHEN|OVER|PARTITION BY|INSERT INTO|UPDATE|DELETE|CREATE TABLE|ALTER TABLE|PRIMARY KEY|FOREIGN KEY|COALESCE)\b/g)) out.add(m[1]);
  for (const m of code.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][\w.]*)/gm)) out.add(m[1].split(".")[0]);
  return [...out].filter((s) => !/^(print|len|str|int|float|range|list|dict|set|type|self|super|return)$/.test(s));
}

function inline(contenu: unknown, ex: Extraction): string {
  if (typeof contenu === "string") return contenu;
  if (!Array.isArray(contenu)) {
    // Tableau BlockNote : { type: "tableContent", rows: [{ cells: [...] }] }
    const c = contenu as { type?: string; rows?: { cells: unknown[] }[] } | null;
    if (c?.type === "tableContent" && Array.isArray(c.rows))
      return c.rows.map((r) => r.cells.map((cell) => inline((cell as { content?: unknown })?.content ?? cell, ex)).join(" | ")).join("\n");
    return "";
  }
  let s = "";
  for (const n of contenu as { type?: string; text?: string; styles?: Record<string, unknown>; content?: unknown }[]) {
    if (n.type === "text") {
      const t = n.text ?? "";
      if (n.styles?.bold && t.trim()) ex.gras.push(t.trim());
      if (n.styles?.code && t.trim()) ex.codeEnLigne.push(t.trim());
      s += t;
    } else if (n.type === "link") s += inline(n.content, ex);
    else if (n.content) s += inline(n.content, ex);
  }
  return s;
}

/** Texte d'un composant JSON : chaînes des clés autorisées, réponses et mise en forme exclues. */
export function texteWidget(langage: string, donnees: unknown, ex: Extraction): string[] {
  const seules = EVALUATIONS[langage];
  const permises = AUTORISEES[langage];
  const out: string[] = [];
  const visiter = (v: unknown, cle: string | null, profondeur: number) => {
    if (profondeur > 8 || v == null) return;
    if (cle !== null) {
      if (seules && !seules.has(cle) && !/^\d+$/.test(cle)) return;
      if (!seules && CLES_INTERDITES.has(cle) && !permises?.has(cle)) return;
      if (cle === "solution" && permises?.has(cle) && typeof v === "string") {
        out.push(`Solution du problème : ${v}`);
        return;
      }
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (!s || /^(https?:|\/|data:)/.test(s) || /^[a-z0-9_-]{1,24}$/.test(s) && cle !== null && /^(id|ton|type)$/.test(cle)) return;
      if (cle === "code") {
        ex.codeEnLigne.push(s);
        ex.identifiants.push(...identifiantsCode(s));
      }
      if (/^(titre|title|nom|label)$/.test(cle ?? "") && s.length <= 80) ex.gras.push(s);
      out.push((cle && PREFIXES[cle]) ? PREFIXES[cle] + s : s);
      return;
    }
    if (typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) visiter(x, null, profondeur + 1);
      return;
    }
    // Objet à clés libres (« etat » d'un visualiseur) : « clé : valeur ».
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (cle === "etat" && typeof x === "string") out.push(`${k} : ${x}`);
      else visiter(x, k, profondeur + 1);
    }
  };
  visiter(donnees, null, 0);
  return out;
}

const ponctuer = (s: string) => (/[.!?:;…»)]$/.test(s) ? s : `${s}.`);

type Bloc = { type: string; props?: Record<string, unknown>; content?: unknown; children?: Bloc[] };

/** Document BlockNote → segments, termes en gras, code en ligne et identifiants. */
export function extraireBlocs(blocs: unknown, titresLecon: string[] = []): Extraction {
  const ex: Extraction = { segments: [], gras: [], codeEnLigne: [], identifiants: [], solutions: [] };
  const pile: { niveau: number; titre: string }[] = [];
  const chemin = () => [...titresLecon, ...pile.map((p) => p.titre)];
  const parcourir = (liste: Bloc[]) => {
    for (const b of liste ?? []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "heading") {
        const niveau = Number(b.props?.level ?? 2);
        const titre = inline(b.content, ex).trim();
        while (pile.length && pile[pile.length - 1].niveau >= niveau) pile.pop();
        if (titre) pile.push({ niveau, titre });
      } else if (b.type === "codeBlock") {
        const langage = String(b.props?.language ?? "text");
        const brut = inline(b.content, ex);
        if (langage === "python-solution" || /solution|corrige/.test(langage)) ex.solutions.push(brut);
        else if (LANGAGES_CODE.has(langage)) {
          const code = brut.trim();
          // Un bloc JSON qui décrit un composant mal étiqueté reste du code : on ne l'interprète pas.
          if (code) {
            ex.segments.push({ titres: chemin(), texte: code, code: true, langage });
            if (langage !== "text") ex.identifiants.push(...identifiantsCode(code));
          }
        } else {
          let donnees: unknown;
          try {
            donnees = JSON.parse(brut);
          } catch {
            donnees = null;
          }
          if (donnees && !(langage in EVALUATIONS && EVALUATIONS[langage].size === 0)) {
            // Corrigés des composants d'évaluation : gardés à part pour leurs empreintes, jamais indexés.
            collecterSolutions(donnees, ex.solutions);
            const morceaux = texteWidget(langage, donnees, ex);
            if (morceaux.length) ex.segments.push({ titres: chemin(), texte: morceaux.map(ponctuer).join(" "), code: false, langage });
          } else if (donnees) collecterSolutions(donnees, ex.solutions);
        }
      } else {
        const t = inline(b.content, ex).trim();
        if (t) {
          const prefixe = b.type === "bulletListItem" || b.type === "numberedListItem" ? "• " : "";
          ex.segments.push({ titres: chemin(), texte: prefixe + t, code: false });
        }
      }
      if (b.children?.length) parcourir(b.children);
    }
  };
  parcourir(Array.isArray(blocs) ? (blocs as Bloc[]) : []);
  return ex;
}

/** Chaînes des clés « solution », « corrige », « answer »… d'un composant (pour les empreintes de code). */
function collecterSolutions(v: unknown, out: string[], profondeur = 0) {
  if (profondeur > 8 || v == null || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (/^(solution|corrige|correction|answer|reponse)$/.test(k) && typeof x === "string") out.push(x);
    else collecterSolutions(x, out, profondeur + 1);
  }
}
