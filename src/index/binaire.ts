// Conteneur binaire des tableaux typés de l'index (graphe CSR, BM25, vecteurs int8, empreintes) :
//   « DRSB » | uint32 longueur de l'en-tête | en-tête JSON | tableaux alignés sur 8 octets.
// La lecture ne copie rien : chaque tableau est une vue sur le fichier chargé.
import { readFileSync, writeFileSync } from "node:fs";

type Typé = Uint8Array | Int8Array | Uint16Array | Uint32Array | Float32Array;
const TYPES = { Uint8Array, Int8Array, Uint16Array, Uint32Array, Float32Array } as const;
type NomType = keyof typeof TYPES;

export function ecrireBinaire(chemin: string, tableaux: Record<string, Typé>, meta: Record<string, unknown> = {}) {
  const entrees: Record<string, { type: NomType; offset: number; length: number }> = {};
  let offset = 0;
  for (const [nom, t] of Object.entries(tableaux)) {
    entrees[nom] = { type: t.constructor.name as NomType, offset, length: t.length };
    offset += Math.ceil(t.byteLength / 8) * 8;
  }
  let entete = Buffer.from(JSON.stringify({ meta, tableaux: entrees }), "utf8");
  const debut = Math.ceil((8 + entete.length) / 8) * 8;
  entete = Buffer.concat([entete, Buffer.alloc(debut - 8 - entete.length, 0x20)]);
  const sortie = Buffer.alloc(debut + offset);
  sortie.write("DRSB", 0, "ascii");
  sortie.writeUInt32LE(entete.length, 4);
  entete.copy(sortie, 8);
  for (const [nom, t] of Object.entries(tableaux)) Buffer.from(t.buffer, t.byteOffset, t.byteLength).copy(sortie, debut + entrees[nom].offset);
  writeFileSync(chemin, sortie);
}

export function lireBinaire(chemin: string): { meta: Record<string, unknown>; tableaux: Record<string, Typé> } {
  let buf = readFileSync(chemin);
  if (buf.toString("ascii", 0, 4) !== "DRSB") throw new Error(`${chemin} : format inconnu`);
  if (buf.byteOffset % 8 !== 0) buf = Buffer.from(new Uint8Array(buf)); // copie alignée (petits fichiers du pool)
  const n = buf.readUInt32LE(4);
  const { meta, tableaux } = JSON.parse(buf.toString("utf8", 8, 8 + n)) as { meta: Record<string, unknown>; tableaux: Record<string, { type: NomType; offset: number; length: number }> };
  const debut = 8 + n;
  const out: Record<string, Typé> = {};
  for (const [nom, e] of Object.entries(tableaux)) out[nom] = new TYPES[e.type](buf.buffer, buf.byteOffset + debut + e.offset, e.length);
  return { meta, tableaux: out };
}
