# Vision — Agentic Learning

## Le problème

L'apprentissage en ligne est souvent isolé : pas de tuteur disponible, pas d'adaptation au contexte métier de l'apprenant, pas de feedback sur les erreurs. Optima (optima.io, racheté par DataCamp) a lancé une solution : un assistant qui connaît le contenu et donne des explications, des indices, du feedback. Mais il lui manque le français, la profondeur du catalogue, la transparence (citations), et les refus clairs quand le contenu ne couvre pas la question.

## La solution : Agentic Learning

Un assistant IA intégré au LMS DATAROCKSTARS qui :

1. **Connaît tout le contenu** : chaque leçon, lab, quiz, exemple du LMS
2. **Répond en français** avec citations exactes (« d'après la leçon X, section Y »)
3. **Refuse quand il doit** : pas de pure hallucination ; 6 portes de refus motivés
4. **S'adapte au mode** : « aide » (pas la solution), « explique autrement » (nouveau point de vue), « indice » (indices gradués)
5. **Autocomplète le code** : suggestion discrète dans les éditeurs (Tab), jamais dans les exercices notés
6. **Évolue** : profil apprenant, explications au métier, retour sur erreurs, rythme adaptatif

## Nos avantages sur Optima

| Critère | Optima | Agentic Learning |
|---------|--------|------------------|
| Langue | Anglais | 🇫🇷 Français |
| Catalogue | Limited | 🎓 Tous les programmes (langages, skills, masters, bootcamps) |
| Transparence | Résumé uniquement | 📍 Citations cliquables vers les leçons |
| Refus | Pas clair | 🚪 6 portes explicites (hors programme, trop vague, rien de citable…) |
| Labs | Démonstration | 💻 Vrais labs Jupyter, pas de téléchargement |
| Notebooks | ✗ | 📓 Support complet |
| Modèles | API (coûts) | 🏃 Légers, ONNX sur CPU (pas d'API externe) |
| Vue formateur | ✗ | 📊 Confusions fréquentes, zones à renforcer |

## Architecture globale

```
LMS DATAROCKSTARS
├─ Routes d'intégration
│  ├─ POST /api/agentic/ask
│  ├─ POST /api/agentic/complete
│  └─ GET /api/agentic/sante
├─ Panneau Assistant (lecteur de leçon)
├─ Autocomplétion CodeMirror
└─ Fonctionnalité « agentic-learning » (opt-in)

        ↑ AGENTIC_SECRET
        |
app-agentic-learning.vercel.app
├─ /api/ask         (question, contexte) → réponse citée
├─ /api/complete    (code) → suggestion
└─ /api/sante       (santé du service)
```

## Cas d'usage

### 1. Étudiant en difficulté sur un concept

*Apprenant* : « Pourquoi on utilise GROUP BY avant WHERE ? »

*Assistant* : « Ah, mais c'est l'inverse ! En SQL, on utilise WHERE avant GROUP BY. À titre d'exemple, d'après la leçon « SQL Avancé », section « Agrégations » :

> WHERE filtre les lignes **avant** l'agrégation, GROUP BY agrège les lignes restantes.

Pour approfondir, tu peux jeter un œil à la section sur les filtres post-agrégation (HAVING). Besoin d'un indice sur le quiz ? »

### 2. Autocomplétion de code

*Apprenant* tape `df.` dans un exercice libre → suggestion fantôme « groupby(...) »

→ Juste la méthode, jamais la solution, jamais dans les exercices notés.

### 3. Feedback sur erreur (livraison 3)

*Apprenant* soumet une réponse fausse au quiz SQL.

*Assistant* : « Pas tout à fait. Rappel : ta condition `date > "2024"` compare une date à du texte. Quel type de conversion te manque ? (Indice 1 / Indice 2 / Indice 3) »

### 4. Explications au métier de l'apprenant (livraison 2)

*Apprenant* (développeur e-commerce) : « Explique GROUP BY pour mon métier »

*Assistant* : « En e-commerce, GROUP BY te permet de :
- Compter les ventes par client → ciblage marketing
- Calculer la moyenne de panier par jour → suivi de tendance
- Lister les produits par catégorie → recommandations

D'après la leçon « SQL pour l'e-commerce », tu vois aussi... »

## Modèle de maîtrise (livraisons 4–6)

La V0 est un assistant d'aide à la demande. Ensuite :

- **Livraison 4** : Adaptation au rythme (concepts maîtrisés vs fragiles)
- **Livraison 5** : Vue formateur (où on doit renforcer)
- **Livraison 6** : Guidage sur capture d'écran

## Modèles et infrastructure

- **Modèles ONNX** : Qwen2.5 0.5B, Coder, e5-small
- **Index** : BM25 + embeddings denses + graphe CSR + ontologie
- **Exécution** : Vercel Functions, CPU uniquement (pas de GPU)
- **Coûts** : Faibles (pas d'API externe, stockage partagé avec LMS)

Voir [architecture.md](architecture.md) pour le détail technique.

## Livraisons

| | | |
|------|---------|---|
| **V0** | Assistant cité | aide + indice + explique, autocomplétion, refus motivés |
| **V1** | Explications au métier | profil apprenant, exemples contextualisés |
| **V2** | Retour sur erreurs | diagnostic + indices gradués, détection du blocage |
| **V3** | Rythme adaptatif | modèle de maîtrise par notion, micro-leçons de rattrapage |
| **V4** | Vue formateur | confusions fréquentes, zones à renforcer |
| **V5** | Guidage sur capture | comparaison de screenshots, annotation |

Chaque livraison : tests e2e, évaluation chiffrée, déploiement, documentation.
