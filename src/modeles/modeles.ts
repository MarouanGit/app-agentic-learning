// Chargement paresseux des modèles ONNX (transformers.js v3 sur onnxruntime-node, CPU), uniquement depuis models/.
// Aucun appel réseau : env.allowRemoteModels = false. Une file par modèle sérialise les générations (un seul calcul
// à la fois par instance : la mémoire reste bornée et une requête n'en ralentit pas dix autres).
import { join } from "node:path";
import { AutoModelForCausalLM, AutoTokenizer, env, pipeline, StoppingCriteria, StoppingCriteriaList, type FeatureExtractionPipeline, type PreTrainedModel, type PreTrainedTokenizer, type Tensor } from "@huggingface/transformers";
import { COMPLETION, REDACTION, VECTEURS, type Modele } from "./catalogue.js";

export const RACINE = process.env.AGENTIC_RACINE ?? process.cwd();
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = join(RACINE, "models") + "/";
env.useFSCache = false;
env.useBrowserCache = false;

class File {
  private queue: Promise<unknown> = Promise.resolve();
  run<T>(f: () => Promise<T>): Promise<T> {
    const p = this.queue.then(f, f);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

// ── Vecteurs (multilingual-e5-small) ─────────────────────────────────────────────────────────────────────────────
let extracteur: Promise<FeatureExtractionPipeline> | null = null;
const fileVecteurs = new File();
export function chargerVecteurs() {
  // (le typage de pipeline() est trop complexe pour TypeScript : on passe par une signature simplifiée)
  const creer = pipeline as unknown as (tache: string, id: string, o: object) => Promise<FeatureExtractionPipeline>;
  return (extracteur ??= creer("feature-extraction", VECTEURS.id, { dtype: VECTEURS.dtype, device: "cpu" }));
}

/** Vecteurs normalisés (moyenne des jetons). e5 attend « query: » pour une question et « passage: » pour un passage. */
export async function vecteurs(textes: string[], prefixe: "query: " | "passage: "): Promise<Float32Array[]> {
  const ex = await chargerVecteurs();
  return fileVecteurs.run(async () => {
    const t = (await ex(textes.map((s) => prefixe + s), { pooling: "mean", normalize: true })) as Tensor;
    const d = t.dims[1];
    const data = t.data as Float32Array;
    return textes.map((_, i) => data.slice(i * d, (i + 1) * d));
  });
}

// ── Modèles génératifs (Qwen2.5 0.5B Instruct, Qwen2.5-Coder 0.5B) ───────────────────────────────────────────────
type Generatif = { tokenizer: PreTrainedTokenizer; model: PreTrainedModel; file: File };
const generatifs = new Map<string, Promise<Generatif>>();
function chargerGeneratif(m: Modele): Promise<Generatif> {
  let p = generatifs.get(m.id);
  if (!p) {
    p = Promise.all([AutoTokenizer.from_pretrained(m.id), AutoModelForCausalLM.from_pretrained(m.id, { dtype: m.dtype, device: "cpu" })]).then(([tokenizer, model]) => ({ tokenizer, model, file: new File() }));
    p.catch(() => generatifs.delete(m.id));
    generatifs.set(m.id, p);
  }
  return p;
}
export const chargerRedaction = () => chargerGeneratif(REDACTION);
export const chargerCompletion = () => chargerGeneratif(COMPLETION);
export const modelesCharges = () => ({ vecteurs: extracteur !== null, redaction: generatifs.has(REDACTION.id), completion: generatifs.has(COMPLETION.id) });

/** Arrêt de la génération : échéance dépassée, ou texte produit jugé terminé par `fini(texte)`. */
class Arret extends StoppingCriteria {
  constructor(private tok: PreTrainedTokenizer, private debut: number, private echeance: number, private fini: (texte: string) => boolean, private etat: { delai: boolean }) {
    super();
  }
  _call(input_ids: (number | bigint)[][]): boolean[] {
    return input_ids.map((ids) => {
      if (Date.now() > this.echeance) return (this.etat.delai = true);
      const nouveaux = ids.slice(this.debut).map(Number);
      return nouveaux.length > 0 && this.fini(this.tok.decode(nouveaux, { skip_special_tokens: true }));
    });
  }
}

export type Generation = { texte: string; jetons: number; delaiDepasse: boolean; ms: number };

async function generer(g: Generatif, entree: { input_ids: Tensor; attention_mask: Tensor }, o: { maxJetons: number; echeance: number; fini?: (t: string) => boolean; repetition?: number }): Promise<Generation> {
  return g.file.run(async () => {
    const t0 = Date.now();
    const debut = entree.input_ids.dims[1];
    const etat = { delai: false };
    if (Date.now() > o.echeance) return { texte: "", jetons: 0, delaiDepasse: true, ms: 0 };
    const criteres = new StoppingCriteriaList();
    criteres.push(new Arret(g.tokenizer, debut, o.echeance, o.fini ?? (() => false), etat));
    const sortie = (await g.model.generate({
      ...entree,
      max_new_tokens: o.maxJetons,
      do_sample: false,
      repetition_penalty: o.repetition ?? 1.0,
      stopping_criteria: criteres,
    } as never)) as Tensor;
    const ids = (sortie.tolist() as bigint[][])[0].slice(debut).map(Number);
    return { texte: g.tokenizer.decode(ids, { skip_special_tokens: true }), jetons: ids.length, delaiDepasse: etat.delai, ms: Date.now() - t0 };
  });
}

export async function rediger(messages: { role: "system" | "user" | "assistant"; content: string }[], o: { maxJetons: number; echeance: number; fini?: (t: string) => boolean }): Promise<Generation> {
  const g = await chargerRedaction();
  const entree = g.tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true }) as { input_ids: Tensor; attention_mask: Tensor };
  return generer(g, entree, { ...o, repetition: 1.1 });
}

/** Remplissage au milieu (FIM) avec le modèle de base Qwen2.5-Coder. */
export async function completerFIM(avant: string, apres: string, o: { maxJetons: number; echeance: number; fini: (t: string) => boolean }): Promise<Generation> {
  const g = await chargerCompletion();
  const prompt = `<|fim_prefix|>${avant}<|fim_suffix|>${apres}<|fim_middle|>`;
  const entree = g.tokenizer(prompt, { add_special_tokens: false }) as { input_ids: Tensor; attention_mask: Tensor };
  return generer(g, entree, o);
}
