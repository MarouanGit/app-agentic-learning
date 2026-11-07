# Architecture — Agentic Learning

## Vue d'ensemble du système

```
┌────────────────────────────────────────────────────────────────┐
│                    LMS DATAROCKSTARS                           │
│  (base de données : cours, leçons, labs, quiz, réponses)       │
└────────────────────┬──────────────────────────────────────────┘
                     │
                ┌────▼────────────────────────────────────────┐
                │ Conversations du LMS (une par projet)       │
                │ - Intégration : routes /api/agentic/*       │
                │ - Panneau Assistant (UI)                    │
                └─────────┬──────────────────────────────────┘
                          │ AGENTIC_SECRET (Bearer token)
                          │
            ┌─────────────▼──────────────────────┐
            │  app-agentic-learning Vercel       │
            │  (cette instance)                  │
            └─────────────────────────────────────┘
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
        ▼                 ▼                  ▼
    ┌────────┐      ┌──────────┐       ┌─────────┐
    │ /ask   │      │ /complete│       │ /sante  │
    └────────┘      └──────────┘       └─────────┘
        │                 │                  │
        └─────────────────┼──────────────────┘
                          │
            ┌─────────────▼──────────────────┐
            │  Moteur Agentic (src/moteur)   │
            │  - Portes de refus (6)         │
            │  - Citations (vérification)    │
            │  - Tri sémantique              │
            │  - Génération de réponses      │
            └─────────────────┬──────────────┘
                              │
        ┌─────────────────────┼────────────────┐
        │                     │                 │
        ▼                     ▼                 ▼
    ┌─────────────┐   ┌──────────────┐   ┌──────────┐
    │ Index       │   │ Modèles ONNX │   │ Texte    │
    │ (données)   │   │ (inférence)  │   │ (prep)   │
    └─────────────┘   └──────────────┘   └──────────┘
```

## Composants

### 1. Index (data/)

**Entrée** : export PostgreSQL du LMS (leçons, labs, quiz, solutions exclues)

**Structure (4 fichiers JSON)** :

- `manifeste.json` — métadonnées (leçons, cours, modules, concepts)
- `passages.json` — texte de chaque leçon, découpé en phrases
- `ontologie.json` — concepts, relations, hiérarchie (IA → Machine Learning → Clustering)
- `bm25-termes.json` — index BM25 (terme → liste de passages)

**Construction** :

1. `exporter.ts` → extraction PostgreSQL → JSON brut
2. `construire.ts` → normalisation → découpe en phrases → ontologie → index BM25 + embeddings
3. Résultat : ~1–2 MB JSON (compressible)

**Garanties** :
- Aucune solution dans l'index (solutions exclues lors de l'export)
- Pas de contenu payant mixé (filtrage par `cours.gratuit`)
- Horodatage de construction (pour traçabilité)

### 2. Modèles ONNX (models/)

Trois modèles légers, exécutés localement (CPU) :

| Modèle | Rôle | Taille | Latence |
|--------|------|--------|---------|
| `Qwen2.5-0.5B-Instruct` | Génération de texte (réponses) | ~0.5B params | ~100 ms |
| `Qwen2.5-Coder-0.5B` | Autocomplétion de code | ~0.5B params | ~50 ms |
| `multilingual-e5-small` | Embeddings denses (citations) | ~33M params | ~20 ms |

**Raison des modèles légers** :
- Vercel Functions : 512 MB RAM, 10 s timeout
- CPU uniquement : pas de GPU disponible
- Inference Time : <100 ms pour réponse rapide

### 3. Moteur (src/moteur/)

**Flux de traitement pour `/api/ask` :**

```
question (≤ 500 chars)
    │
    ▼
1. Normalisation (racine, technos, synonymes)
    │
    ▼
2. Porte 1 : Requête valide ?
    │ non → refus « pas d'entrée »
    ▼
3. Porte 2 : Question assez précise ?
    │ non → refus « trop vague »
    ▼
4. Recherche passage (BM25 + e5-small)
    │ (top-K par catégorie : cours, leçons, concepts)
    ▼
5. Porte 3 : Résultat pertinent ?
    │ non → refus « hors programme »
    ▼
6. Porte 4 : Contenu suffisant pour répondre ?
    │ non → refus « rien de citable »
    ▼
7. Filtre cours (gratuit vs payant, selon apprenant)
    │ (ex: étudiant gratuit → exclu les labs payants)
    ▼
8. Porte 5 : Contenu retiré/archivé ?
    │ non → rejet si outdated
    ▼
9. Génération (Qwen instruct, prompt adapté au mode)
    │ (aide, indice, explique)
    ▼
10. Porte 6 : Réponse a vraiment utilisé le contenu ?
    │ (vérif rapide des citations)
    ▼
11. Citations (extraction, ranking, déduplication)
    │
    ▼
réponse { statut, texte, citations, trace }
```

### 4. Routes API (api/)

#### POST /api/ask

```json
{
  "question": "Pourquoi GROUP BY avant WHERE ?",
  "cours": "sql-bases",       // optionnel
  "lecon": "agrégations",     // optionnel
  "code": "SELECT...",        // optionnel (<4000 chars)
  "mode": "aide",             // "aide" | "indice" | "explique"
  "autorises": ["sql-bases"]  // cours accessibles par apprenant
}
```

**Réponse** :
```json
{
  "statut": "reponse",
  "texte": "En SQL, on utilise WHERE **avant** GROUP BY. D'après la leçon...",
  "citations": [
    {
      "n": 1,
      "cours": "sql-bases",
      "coursTitre": "SQL — Les bases",
      "lecon": "agrégations",
      "titre": "Ordre des clauses : WHERE puis GROUP BY",
      "extrait": "WHERE filtre **avant** l'agrégation...",
      "url": "https://app-lms-drs.vercel.app/lms/cours/sql-bases/lecon/agregations"
    }
  ],
  "refus": null,
  "trace": {
    "portes": [
      { "n": 1, "nom": "Requête valide", "ok": true, "ms": 2 },
      { "n": 2, "nom": "Précision", "ok": true, "ms": 5 },
      { "n": 3, "nom": "Pertinence", "ok": true, "ms": 12 },
      { "n": 4, "nom": "Contenu", "ok": true, "ms": 8 },
      { "n": 5, "nom": "Accès", "ok": true, "ms": 1 },
      { "n": 6, "nom": "Vérification", "ok": true, "ms": 10 }
    ],
    "modele": "Qwen2.5-0.5B-Instruct",
    "ms": 50
  }
}
```

#### POST /api/complete

```json
{
  "langage": "python",
  "avant": "import pandas as pd\ndf = pd.read_csv('data.csv')\ndf.",
  "apres": "",
  "cours": "python-datascience",
  "lecon": "pandas"
}
```

**Réponse** :
```json
{
  "suggestion": "groupby(",
  "modele": "Qwen2.5-Coder-0.5B",
  "ms": 45
}
```

#### GET /api/sante

```json
{
  "ok": true,
  "index": {
    "lecons": 142,
    "passages": 8234,
    "concepts": 567,
    "aretes": 1203,
    "construitLe": "2026-11-07T14:32:00Z"
  },
  "modeles": [
    { "nom": "Qwen2.5-0.5B-Instruct", "charge": 0.34 },
    { "nom": "Qwen2.5-Coder-0.5B", "charge": 0.12 },
    { "nom": "multilingual-e5-small", "charge": 0.18 }
  ]
}
```

## Flux de données

### Construction (offline, une fois par semaine)

```
LMS PostgreSQL
     │
     ├─ exporter.ts (lecture seule)
     │  → leçons, labs, quiz
     │  → excluant solutions et contenu retiré
     │
     ├─ construire.ts
     │  → normalisation texte
     │  → découpe en phrases
     │  → ontologie automatique
     │  → BM25 + e5-small embeddings
     │
     └─ data/index/
        ├─ manifeste.json
        ├─ passages.json
        ├─ ontologie.json
        └─ bm25-termes.json
```

### Inférence (runtime, par requête)

```
Vercel Functions (app-agentic-learning)
     │
     ├─ Charger index (cache en mémoire)
     ├─ Charger modèles (cache ONNX)
     ├─ Traiter requête (portes → recherche → génération)
     └─ Retourner réponse (JSON)
```

## Performance et limites

| Métrique | Cible | Réalité |
|----------|-------|---------|
| Latence /ask | <500 ms | ~100–150 ms (BM25 + inférence) |
| Latence /complete | <200 ms | ~50–80 ms |
| Mémoire | <512 MB | ~300 MB (index + modèles) |
| Timeout Vercel | 10 s | ✓ Confortable |
| Coûts | Negligible | CPU uniquement |

## Sécurité

- **Authentification** : Bearer token (AGENTIC_SECRET)
- **Données** : aucune donnée apprenant persistée ; logs d'appels (non contenu)
- **Confidentialité** : filtrage par `autorises` (cours accessibles)
- **Injection** : prompt classique (pas d'exécution de code)

Voir [securite.md](securite.md).
