// Export EN LECTURE SEULE des cours, modules et leçons publiés du LMS (base de prod) vers data/export/lms.json.
//
//   npm run exporter   (= tsx --env-file=$HOME/Workspace/lms/.env.vercel-prod.local scripts/exporter.ts)
//
// - Une seule transaction « read only », uniquement des SELECT : la base refuserait toute écriture.
// - DATABASE_URL n'est jamais affichée (ni dans les messages d'erreur : on n'imprime que le code de l'erreur).
// - Solutions, corrigés, scripts de contrôle et indices des exercices et des labs ne sont PAS exportés : seules leurs
//   empreintes (fragments hachés, irréversibles) le sont, pour détecter au runtime qu'un passage ou une réponse les recopie.
// - Leçons non publiées (ou masquées) et cours non publiés : titre et identifiants seulement (porte 5 « retire »).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { empreintesCode } from "../src/texte/empreintes.js";

/** Même règle que cleanDatabaseUrl du LMS (src/db/index.ts) : postgres.js transmettrait channel_binding tel quel (refusé). */
function cleanDatabaseUrl(url: string) {
  const u = new URL(url);
  u.searchParams.delete("channel_binding");
  return u.toString();
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant (lancer avec --env-file=$HOME/Workspace/lms/.env.vercel-prod.local)");
  process.exit(1);
}
const sql = postgres(cleanDatabaseUrl(url), { ssl: "require", prepare: false, max: 1, idle_timeout: 5, onnotice: () => {} });

type Cours = { id: number; slug: string; title: string; subtitle: string | null; description: string | null; category: string; tags: string[]; position: number; programmes: { slug: string; titre: string; domaine: string | null }[] };
type Module = { id: number; courseId: number; title: string; part: string | null; chapter: string | null; position: number };
type Placement = { moduleId: number; lessonId: number; position: number; visible: boolean };
type Lecon = {
  id: number; slug: string; title: string; type: string; labKind: string | null; objectives: string[]; published: boolean;
  content: unknown; meta: Record<string, unknown>; exercise: Record<string, unknown> | null; solution: string | null;
  notebookId: number | null; labId: number | null; updatedAt: Date;
};
type Lab = { id: number; slug: string; title: string; summary: string | null; tools: string[] | null; steps: { id: string; title: string; instructionsHtml: string; solution: string | null }[] };
type Notebook = { id: number; slug: string; title: string; summary: string | null };

const t0 = Date.now();
try {
  const res = await sql.begin("read only", async (tx) => {
    const cours = await tx<Cours[]>`
      select c.id, c.slug, c.title, c.subtitle, c.description, c.category, c.tags, c.position,
             coalesce((select json_agg(json_build_object('slug', p.slug, 'titre', p.title, 'domaine', d.title) order by p.position, p.id)
                       from program_courses pc join programs p on p.id = pc.program_id left join domains d on d.id = p.domain_id
                       where pc.course_id = c.id and p.published), '[]'::json) as programmes
      from courses c where c.published and c.deleted_at is null order by c.position, c.id`;
    const ids = cours.map((c) => c.id);
    const modules = await tx<Module[]>`
      select id, course_id as "courseId", title, part, chapter, position from modules where course_id = any(${ids}) order by course_id, position, id`;
    const placements = await tx<Placement[]>`
      select ml.module_id as "moduleId", ml.lesson_id as "lessonId", ml.position, ml.visible
      from module_lessons ml join modules m on m.id = ml.module_id where m.course_id = any(${ids}) order by ml.module_id, ml.position, ml.lesson_id`;
    const lessonIds = [...new Set(placements.map((p) => p.lessonId))];
    // Contenu seulement pour un composant publié ; l'exercice sans solution, validation, indices ni explication de corrigé.
    const lecons = await tx<Lecon[]>`
      select l.id, l.slug, l.title, l.type, l.lab_kind as "labKind", l.objectives, l.published,
             case when l.published then l.content else null end as content,
             l.meta,
             case when l.published and l.exercise is not null then jsonb_build_object(
               'title', l.exercise->'title', 'lang', l.exercise->'lang', 'mode', l.exercise->'mode',
               'instructionsHtml', l.exercise->'instructionsHtml', 'example', l.exercise->'example', 'starterCode', l.exercise->'starterCode')
             end as exercise,
             case when l.published then l.exercise->>'solution' end as solution,
             l.notebook_id as "notebookId", l.lab_id as "labId", l.updated_at as "updatedAt"
      from lessons l where l.deleted_at is null and l.id = any(${lessonIds}) order by l.id`;
    const labIds = [...new Set(lecons.filter((l) => l.published && l.labId).map((l) => l.labId!))];
    const labs = await tx<Lab[]>`
      select id, slug, title, spec->>'summary' as summary, coalesce(spec->'tools', '[]'::jsonb) as tools,
             coalesce((select json_agg(json_build_object('id', s->>'id', 'title', s->>'title', 'instructionsHtml', s->>'instructionsHtml', 'solution', s->>'solution'))
                       from jsonb_array_elements(spec->'steps') s), '[]'::json) as steps
      from labs where id = any(${labIds})`;
    const nbIds = [...new Set(lecons.filter((l) => l.published && l.notebookId).map((l) => l.notebookId!))];
    const notebooks = await tx<Notebook[]>`select id, slug, title, spec->>'summary' as summary from notebooks where id = any(${nbIds})`;
    // Cours non publiés (hors corbeille) : leurs leçons ne sont connues que par leur titre (porte 5).
    const coursRetires = await tx<{ slug: string; title: string; lessons: { slug: string; title: string }[] }[]>`
      select c.slug, c.title,
             coalesce((select json_agg(json_build_object('slug', l.slug, 'title', l.title))
                       from modules m join module_lessons ml on ml.module_id = m.id join lessons l on l.id = ml.lesson_id
                       where m.course_id = c.id and l.deleted_at is null), '[]'::json) as lessons
      from courses c where not c.published and c.deleted_at is null`;
    return { cours, modules, placements, lecons, labs, notebooks, coursRetires };
  });

  // Empreintes des solutions (exercices de code, étapes de lab) puis effacement du texte clair.
  const empreintes = new Set<number>();
  for (const l of res.lecons) {
    if (l.solution) for (const h of empreintesCode(l.solution)) empreintes.add(h);
    l.solution = null;
  }
  for (const lab of res.labs)
    for (const s of lab.steps) {
      if (s.solution) for (const h of empreintesCode(s.solution)) empreintes.add(h);
      s.solution = null;
    }

  const dossier = join(import.meta.dirname, "../data/export");
  mkdirSync(dossier, { recursive: true });
  const sortie = { exporteLe: new Date().toISOString(), ...res, empreintesSolutions: [...empreintes].sort((a, b) => a - b) };
  writeFileSync(join(dossier, "lms.json"), JSON.stringify(sortie));
  const publiees = res.lecons.filter((l) => l.published).length;
  console.log(
    `Export en ${((Date.now() - t0) / 1000).toFixed(1)} s : ${res.cours.length} cours, ${res.modules.length} modules, ${res.placements.length} placements, ` +
      `${publiees} leçons publiées (${res.lecons.length - publiees} non publiées), ${res.labs.length} labs, ${res.notebooks.length} notebooks, ` +
      `${res.coursRetires.length} cours non publiés, ${empreintes.size} empreintes de solutions.`,
  );
} catch (e) {
  const err = e as { code?: string; message?: string };
  // Jamais le message brut : il peut contenir l'hôte ou l'utilisateur de la base.
  console.error(`✗ Export impossible (code ${err.code ?? "inconnu"}).`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
