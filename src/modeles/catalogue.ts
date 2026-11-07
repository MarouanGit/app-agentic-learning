// Modèles open source exécutés DANS la fonction (onnxruntime-node, CPU), aux révisions Hugging Face épinglées.
// scripts/telecharger-modeles.ts les télécharge au build (tailles et empreintes SHA-256 contrôlées) ;
// au runtime, transformers.js les lit dans models/ (env.allowRemoteModels = false).

export type FichierModele = { chemin: string; octets: number; sha256: string };
export type Modele = {
  role: "redaction" | "completion" | "vecteurs";
  id: string; // dépôt Hugging Face
  revision: string; // commit épinglé
  dtype: "q8" | "int8"; // int8 : quantification dynamique 8 bits (MatMulInteger), rapide sur onnxruntime-node CPU
  fichiers: FichierModele[];
};

export const REDACTION: Modele = {
  role: "redaction",
  id: "onnx-community/Qwen2.5-0.5B-Instruct",
  revision: "22942cb7d7ba4cc81bb4673549ca4d4614469b5e",
  dtype: "int8",
  fichiers: [
    { chemin: "config.json", octets: 678, sha256: "777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5" },
    { chemin: "generation_config.json", octets: 242, sha256: "f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3" },
    { chemin: "tokenizer.json", octets: 7031673, sha256: "a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf" },
    { chemin: "tokenizer_config.json", octets: 7849, sha256: "6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430" },
    { chemin: "onnx/model_int8.onnx", octets: 512096557, sha256: "41834041ab1b29eff9fc592f1a29a1844133aea35832ea9fa91682be13016100" },
  ],
};

// Modèle de base (pas Instruct) : il connaît le remplissage au milieu (FIM, <|fim_prefix|> … <|fim_suffix|> … <|fim_middle|>).
export const COMPLETION: Modele = {
  role: "completion",
  id: "onnx-community/Qwen2.5-Coder-0.5B-ONNX",
  revision: "c0bbc5c5a8c86c9aa4e2e6e3cbd23219042b2351",
  dtype: "int8",
  fichiers: [
    { chemin: "config.json", octets: 842, sha256: "da13e32a1396b686bebaaff9064ed416a3fd4e76c3e7f557a766314340248fc5" },
    { chemin: "generation_config.json", octets: 117, sha256: "9e9135a1f6c3c54fd52f5e8011067e4039f8ff3ad0294980137632c461ea60f7" },
    { chemin: "tokenizer.json", octets: 9116490, sha256: "bb5953180a154511cf4d0fb1fc68a3433f1458aa6db3851ac2609cf41e7d9b5b" },
    { chemin: "tokenizer_config.json", octets: 7228, sha256: "58c4abbc36eeccd8b3c8453f262225e8f2803855c88790760b618f4cd9e43be9" },
    { chemin: "onnx/model_int8.onnx", octets: 502904495, sha256: "9fb1629ca3dddc2be41570a311ea5a2332f0ca6ca5880fa575279bdb40915b01" },
  ],
};

export const VECTEURS: Modele = {
  role: "vecteurs",
  id: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  dtype: "q8",
  fichiers: [
    { chemin: "config.json", octets: 658, sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1" },
    { chemin: "tokenizer.json", octets: 17082730, sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
    { chemin: "tokenizer_config.json", octets: 443, sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b" },
    { chemin: "special_tokens_map.json", octets: 167, sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7" },
    { chemin: "onnx/model_quantized.onnx", octets: 118308185, sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193" },
  ],
};

export const MODELES: Modele[] = [REDACTION, COMPLETION, VECTEURS];

/** Nom court affiché dans les réponses et /api/sante. */
export const nomModele = (m: Modele) => `${m.id.split("/")[1]}@${m.revision.slice(0, 7)} (${m.dtype})`;
