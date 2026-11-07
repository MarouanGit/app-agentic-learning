# API — Agentic Learning

## Authentification

Toutes les routes requièrent un Bearer token dans l'en-tête `Authorization` :

```
Authorization: Bearer <AGENTIC_SECRET>
```

`AGENTIC_SECRET` est un secret partagé entre le LMS et cette instance Agentic Learning (configuré via variables d'environnement sur Vercel).

## POST /api/ask

Pose une question sur le contenu du LMS et reçoit une réponse citée.

### Requête

```json
{
  "question": "Pourquoi on utilise GROUP BY avant WHERE ?",
  "cours": "sql-bases",
  "lecon": "agregations",
  "code": "SELECT ... FROM table",
  "mode": "aide",
  "autorises": ["sql-bases", "python-101"]
}
```

| Champ | Type | Limite | Requis ? | Description |
|-------|------|--------|----------|-------------|
| `question` | string | ≤ 500 chars | ✓ | La question de l'apprenant |
| `cours` | string | – | Non | ID du cours (contexte) |
| `lecon` | string | – | Non | ID de la leçon (contexte) |
| `code` | string | ≤ 4000 chars | Non | Code de l'éditeur (contexte) |
| `mode` | enum | – | ✓ | `"aide"` (pas la solution), `"indice"` (indices gradués), `"explique"` (autre approche) |
| `autorises` | array | – | ✓ | Liste des cours accessibles par l'apprenant (filtrage d'accès) |

### Réponse (200 OK)

```json
{
  "statut": "reponse",
  "texte": "En SQL, on utilise WHERE **avant** GROUP BY. D'après la leçon « Agrégations »...",
  "citations": [
    {
      "n": 1,
      "cours": "sql-bases",
      "coursTitre": "SQL — Les bases",
      "lecon": "agregations",
      "titre": "Ordre des clauses : WHERE puis GROUP BY",
      "extrait": "WHERE filtre les lignes **avant** l'agrégation, GROUP BY agrège les lignes restantes.",
      "url": "https://app-lms-drs.vercel.app/lms/cours/sql-bases/lecon/agregations?section=order-clauses"
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

### Réponse (refus)

```json
{
  "statut": "refus",
  "texte": null,
  "citations": [],
  "refus": {
    "porte": 3,
    "code": "HORS_PROGRAMME",
    "message": "Cette question sort du périmètre des cours disponibles. Essaie de poser la question en rapport avec une leçon du LMS."
  },
  "trace": {
    "portes": [
      { "n": 1, "nom": "Requête valide", "ok": true, "ms": 2 },
      { "n": 2, "nom": "Précision", "ok": true, "ms": 5 },
      { "n": 3, "nom": "Pertinence", "ok": false, "ms": 12 }
    ],
    "modele": null,
    "ms": 22
  }
}
```

### Les 6 portes de refus

| Porte | Code | Quand ? | Message |
|-------|------|--------|---------|
| 1 | PAS_D_ENTREE | Question vide, ou trop générique (« comment ça marche ? ») | « Ta question est trop vague. Décris plutôt ce que tu veux faire. » |
| 2 | TROP_VAGUE | Question trop courte ou sans verbe d'action | « Je n'ai pas compris ta question. Ajoute plus de détails. » |
| 3 | HORS_PROGRAMME | Aucune pertinence détectée dans l'index | « Cette question sort du périmètre des cours disponibles. » |
| 4 | RIEN_DE_CITABLE | Pertinent, mais aucun passage de contenu exploitable | « Le LMS n'a pas assez de contenu pour répondre précisément. » |
| 5 | CONTENU_RETIRE | Contenu archivé, marqué comme retiré, ou accès refusé | « Le contenu de cette réponse a été retiré ou archivé. » |
| 6 | REPONSE_NON_VERIFIEE | Réponse générée, mais non-validation post-inférence | « Je ne suis pas sûr de ma réponse. Pose ta question au formateur. » |

### Codes d'erreur

| Code | Statut HTTP | Description |
|------|------------|-------------|
| 401 | Unauthorized | Token manquant ou invalide |
| 400 | Bad Request | Paramètres invalides (ex: mode inconnu) |
| 500 | Internal Server Error | Erreur interne (modèle crash, index corrompu) |
| 503 | Service Unavailable | Service en maintenance ou surchargé |

## POST /api/complete

Autocomplétion de code (suggestion discrète, Tab).

### Requête

```json
{
  "langage": "python",
  "avant": "import pandas as pd\ndf = pd.read_csv('data.csv')\ndf.",
  "apres": "",
  "cours": "python-datascience",
  "lecon": "pandas-intro"
}
```

| Champ | Type | Limite | Requis ? | Description |
|-------|------|--------|----------|-------------|
| `langage` | enum | – | ✓ | `"python"`, `"sql"`, `"javascript"`, … |
| `avant` | string | ≤ 4000 chars | ✓ | Code avant le curseur |
| `apres` | string | ≤ 2000 chars | Non | Code après le curseur |
| `cours` | string | – | Non | Contexte du cours |
| `lecon` | string | – | Non | Contexte de la leçon |

### Réponse (200 OK)

```json
{
  "suggestion": "groupby(",
  "modele": "Qwen2.5-Coder-0.5B",
  "ms": 45
}
```

**Note** : la suggestion ne doit **jamais** être la solution complète (ex: fonction entière), juste une méthode ou un début d'expression.

### Codes d'erreur

| Code | Statut HTTP | Description |
|------|------------|-------------|
| 400 | Bad Request | Langage non supporté, ou code trop long |
| 500 | Internal Server Error | Erreur du modèle Coder |

## GET /api/sante

État du service et statistiques de l'index. **Cette route ne requiert pas de token d'authentification**.

### Requête

```
GET https://app-agentic-learning.vercel.app/api/sante
```

(aucun header d'authentification nécessaire)

### Réponse (200 OK)

```json
{
  "ok": true,
  "index": {
    "lecons": 2809,
    "passages": 14197,
    "concepts": 32193,
    "aretes": 471172,
    "construitLe": "2026-11-07T14:32:00Z"
  },
  "modeles": [
    { "role": "redaction", "nom": "Qwen2.5-0.5B-Instruct" },
    { "role": "autocompletion", "nom": "Qwen2.5-Coder-0.5B" },
    { "role": "vecteurs", "nom": "multilingual-e5-small" }
  ]
}
```

**Note** : les métadonnées d'index et les modèles sont publiques (pas d'information sensible).

## Exemples d'intégration

### cURL

```bash
# /api/ask
curl -X POST https://app-agentic-learning.vercel.app/api/ask \
  -H "Authorization: Bearer $AGENTIC_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Comment faire un LEFT JOIN en SQL ?",
    "mode": "aide",
    "autorises": ["sql-bases"]
  }'

# /api/complete
curl -X POST https://app-agentic-learning.vercel.app/api/complete \
  -H "Authorization: Bearer $AGENTIC_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "langage": "python",
    "avant": "df.head(",
    "cours": "pandas-intro"
  }'

# /api/sante
curl -H "Authorization: Bearer $AGENTIC_SECRET" \
  https://app-agentic-learning.vercel.app/api/sante
```

### Node.js

```javascript
async function ask(question, mode, autorises) {
  const res = await fetch('https://app-agentic-learning.vercel.app/api/ask', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.AGENTIC_SECRET}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ question, mode, autorises })
  });
  return res.json();
}

const reponse = await ask('Comment faire un LEFT JOIN en SQL ?', 'aide', ['sql-bases']);
console.log(reponse.texte);
reponse.citations.forEach(c => console.log(`- ${c.titre} (${c.coursTitre})`));
```

## Limites et comportement

| Aspect | Limite | Notes |
|--------|--------|-------|
| Taille requête | 500 chars (question) | Au-delà → refus « trop long » |
| Taille réponse | ~500 tokens (~2000 chars) | Raison : latence + LLM token limits |
| Latence cible | <500 ms | BM25 + inférence + citations |
| Concurrent requests | 10 (Vercel Function) | Scaling automatique |
| Cache index | RAM (en mémoire) | Recharge toutes les 12 h (configuré) |
| Timeout | 10 s (Vercel) | Robustesse interne à 8 s |

## Monitoring

Chaque réponse inclut un objet `trace` pour les logs et le monitoring :

```json
"trace": {
  "portes": [
    { "n": 1, "nom": "Requête valide", "ok": true, "ms": 2 },
    …
  ],
  "modele": "Qwen2.5-0.5B-Instruct",
  "ms": 50
}
```

**À logger** (pour tableau de bord futur) :
- Portée de refus (quel filtre a bloqué)
- Latence par porte
- Modèle utilisé
- Taux de citations réussies

Voir [exploitation.md](exploitation.md) pour le setup des logs.
