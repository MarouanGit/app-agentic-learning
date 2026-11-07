// Télécharge les modèles ONNX dans models/, aux révisions épinglées de src/modeles/catalogue.ts.
// Chaque fichier est contrôlé (taille exacte, SHA-256 quand il est connu) ; un fichier déjà présent et conforme n'est pas retéléchargé.
// Lancé par « npm run build » sur Vercel (les modèles ne sont pas dans le dépôt) et par « npm run modeles » en local.
//
//   tsx scripts/telecharger-modeles.ts                      # tous les modèles
//   tsx scripts/telecharger-modeles.ts --roles=vecteurs      # un sous-ensemble
//   tsx scripts/telecharger-modeles.ts --verifier-index      # échoue aussi si data/index/ manque (build Vercel)
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MODELES, type FichierModele, type Modele } from "../src/modeles/catalogue.js";

const RACINE = join(import.meta.dirname, "..");
const DOSSIER = join(RACINE, "models");
const PLAFOND_OCTETS = 2.5 * 1024 ** 3; // garde-fou : l'ensemble des modèles reste sous 2,5 Go

const args = process.argv.slice(2);
const roles = args.find((a) => a.startsWith("--roles="))?.slice(8).split(",");
const choisis = MODELES.filter((m) => !roles || roles.includes(m.role));

async function sha256(fichier: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(fichier), h);
  return h.digest("hex");
}

async function conforme(fichier: string, f: FichierModele): Promise<boolean> {
  if (!existsSync(fichier) || statSync(fichier).size !== f.octets) return false;
  return !f.sha256 || (await sha256(fichier)) === f.sha256;
}

async function telecharger(m: Modele, f: FichierModele) {
  const cible = join(DOSSIER, m.id, f.chemin);
  if (await conforme(cible, f)) return { chemin: f.chemin, statut: "déjà là" };
  mkdirSync(dirname(cible), { recursive: true });
  const url = `https://huggingface.co/${m.id}/resolve/${m.revision}/${f.chemin}`;
  const tmp = `${cible}.partiel`;
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const annonce = Number(r.headers.get("content-length") ?? f.octets);
      if (annonce !== f.octets) throw new Error(`taille annoncée ${annonce} ≠ ${f.octets}`);
      await pipeline(Readable.fromWeb(r.body as never), createWriteStream(tmp));
      const taille = statSync(tmp).size;
      if (taille !== f.octets) throw new Error(`taille reçue ${taille} ≠ ${f.octets}`);
      if (f.sha256) {
        const h = await sha256(tmp);
        if (h !== f.sha256) throw new Error(`empreinte ${h.slice(0, 12)}… ≠ ${f.sha256.slice(0, 12)}…`);
      }
      renameSync(tmp, cible);
      return { chemin: f.chemin, statut: "téléchargé" };
    } catch (e) {
      rmSync(tmp, { force: true });
      if (essai === 3) throw new Error(`${m.id}/${f.chemin} : ${(e as Error).message}`);
    }
  }
  throw new Error("inatteignable");
}

const total = choisis.flatMap((m) => m.fichiers).reduce((s, f) => s + f.octets, 0);
if (total > PLAFOND_OCTETS) throw new Error(`Modèles trop lourds : ${(total / 1024 ** 3).toFixed(2)} Go`);
const t0 = Date.now();
for (const m of choisis) {
  const res = await Promise.all(m.fichiers.map((f) => telecharger(m, f)));
  const octets = m.fichiers.reduce((s, f) => s + f.octets, 0);
  console.log(`${m.role.padEnd(10)} ${m.id}@${m.revision.slice(0, 7)} (${m.dtype}) ${(octets / 1024 ** 2).toFixed(0)} Mo : ${res.map((r) => r.statut).join(", ")}`);
}
console.log(`Modèles prêts en ${((Date.now() - t0) / 1000).toFixed(1)} s (${(total / 1024 ** 3).toFixed(2)} Go).`);

if (args.includes("--verifier-index") && !existsSync(join(RACINE, "data/index/manifeste.json"))) {
  console.error("✗ data/index/manifeste.json manque : construire l'index en local (npm run index) avant de déployer.");
  process.exit(1);
}
