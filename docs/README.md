# Agentic Learning — Documentation

Assistant d'apprentissage qui connaît le contenu du LMS DATAROCKSTARS et peut répondre à n'importe quelle question en citant les leçons et en proposant des indices, sans jamais donner la solution.

## Vue d'ensemble

- **Vision** — [vision.md](vision.md) : ce que c'est, pourquoi, comment ça se distingue d'Optima
- **Architecture** — [architecture.md](architecture.md) : schéma, moteur, index, modèles, citations
- **API** — [api.md](api.md) : contrat complet des 3 routes (ask, complete, sante)
- **Sécurité** — [securite.md](securite.md) : contenu payant, secrets, filtrage des cours, confidentialité
- **Exploitation** — [exploitation.md](exploitation.md) : construction de l'index, déploiement, coûts, limites

## Livraisons

Voir [ROADMAP.md](../ROADMAP.md) pour la feuille de route complète en 6 livraisons.

**V0 (Livraison 1)** — Un assistant qui connaît tout le cours : réponse en français avec citations, refus motivés (6 portes), trois modes (aide, explique, indice), autocomplétion de code dans les éditeurs libres.

## Instances

- **Production** : `https://app-agentic-learning.vercel.app` (déploiement automatique depuis cette branche)
- **Staging** : variable d'environnement `AGENTIC_URL` du LMS
- **Local** : `npm run serveur` (http://localhost:3000)

## Intégration au LMS

L'instance du LMS consomme :
- `POST /api/ask` — question, contexte optionnel, mode
- `POST /api/complete` — autocomplétion de code
- `GET /api/sante` — santé du service et index

Voir [api.md](api.md) pour le détail.

## Commandes

```bash
npm run modeles               # Télécharger les modèles ONNX
npm run index                 # Exporter + construire l'index (requiert LMS_DATABASE_URL)
npm run serveur              # Lancer le serveur local (Node.js 24)
npm test                     # Tests unitaires
npm run typecheck            # Vérifier les types TypeScript
```

## Déploiement

```bash
# Sur machine avec jeton Vercel configuré
bash scripts/deploy.sh
```

Voir [exploitation.md](exploitation.md) pour les détails.
