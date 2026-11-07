# Reprise : le produit Agentic Learning

Ce fichier passe le projet à cette conversation (onglet dédié). La conversation du LMS reste sur le LMS ; celle-ci porte le **produit Agentic Learning**, de bout en bout.

## Le produit
- Un assistant d'aide à l'apprentissage, « comme Optima (optima.io, racheté par DataCamp), mais en beaucoup mieux ». C'est un **produit à part**, intégré au LMS DATAROCKSTARS.
- Feuille de route en 6 livraisons : ROADMAP.md.
- L'expérience visée, d'après la capture Optima envoyée par Marouan :
  - à gauche, le tuteur : retour personnalisé sur la réponse, « écouter le tuteur » (lecture à voix haute), « demander à tout moment », rythme adaptatif, exemples personnalisés au métier, bouton Continuer ;
  - à droite, l'environnement interactif : éditeur, Exécuter, Soumettre, sortie en tableau, consignes.
- Notre plus : le français, tout le catalogue du LMS, des réponses citées et des refus motivés (6 portes), les notebooks et les labs, et la vue du formateur.
- Architecture d'inspiration : « Agentic Knowledge Graph Engine » (https://levelup.gitconnected.com/structuring-40-million-documents-into-an-agentic-knowledge-graph-92010e609dfa). Elle comprend un ancrage lexical et dense, une ontologie, un lien vers les concepts, un graphe CSR, l'échelle de refus, un tri sémantique, la validation des citations et une construction hors ligne sans modèle génératif.

## Règles (demandes explicites de Marouan)
- **Instance Vercel séparée** : projet `app-agentic-learning` (équipe datarockstars), déployé par `bash scripts/deploy.sh` (copie sans .git, CLI `npx --yes vercel@65.1.0` déjà connectée au compte tech backoffice). Jamais dans le projet Vercel du LMS.
- Modèles **open source légers exécutés dans Vercel** (Qwen2.5 0.5B Instruct et Coder, multilingual-e5-small, ONNX sur CPU), sans API externe.
- Documenter le produit « comme d'habitude » : README, docs du produit, journal, mémoire (native et Obsidian, voir ~/.claude/CLAUDE.md).
- Réponses en français, action plutôt que discussion, économie de tokens.
- Base de prod du LMS en **lecture seule** uniquement : export avec `--env-file=$HOME/Workspace/lms/.env.vercel-prod.local`, jamais affiché.
- Secrets jamais affichés. AGENTIC_SECRET est dans .env.local (gitignoré).
- Aucune publication en ligne hors des déploiements du produit (pas d'Artifact).
- Commits terminés par la ligne Co-Authored-By de Claude.

## État au moment de la reprise (07/11/2026)
- **Moteur V0 (livraison 1) en construction** par un agent lancé depuis la conversation du LMS, dans ce dépôt : scripts/ (export, découpe, ontologie, CSR, BM25, vecteurs), src/moteur/ (portes, tri, citations), api/ (ask, complete, sante), eval/, README.md, scripts/deploy.sh. **Ne modifie pas ces fichiers avant son rapport** : la conversation du LMS te le transmettra par message.
- **Intégration côté LMS** (dépôt ~/Workspace/lms) : elle est faite par la conversation du LMS. Elle comprend les routes /api/agentic/ask et /complete, le panneau Assistant dans le lecteur de leçon, l'autocomplétion CodeMirror (jamais dans un exercice noté) et la fonctionnalité « agentic-learning », désactivée par défaut. Ne touche pas au dépôt du LMS : pour changer le contrat, demande-le à la conversation du LMS.
- Contrat de la V0, utilisé par le LMS côté serveur :
  - Authentification : `Authorization: Bearer <AGENTIC_SECRET>`.
  - POST /api/ask
    - entrée : { question (≤ 500), cours?, lecon?, code? (≤ 4000), mode: "aide"|"indice"|"explique", autorises: string[] | "tous" }
    - sortie : { statut: "reponse"|"refus", texte, citations: [{ n, cours, coursTitre, lecon, titre, extrait, url }], refus?: { porte, code, message }, trace: { portes: [{ n, nom, ok, ms }], modele, ms } }
  - POST /api/complete
    - entrée : { langage, avant, apres, cours?, lecon? }
    - sortie : { suggestion, modele, ms }
  - GET /api/sante : { ok, index: { lecons, passages, concepts, aretes, construitLe }, modeles }

## Tes premières tâches
1. **Documentation du produit**, pendant que la V0 se termine :
   - docs/ : vision, architecture (schéma), contrat d'API, évaluation, sécurité et confidentialité (contenu payant, secret, filtre des cours), exploitation (construction de l'index, déploiement, coûts, limites) ;
   - une page produit « Agentic Learning » (vitrine + docs) servie par l'instance du produit.
2. **L'expérience « Studio »** façon Optima, en mieux, dans le produit : tuteur à gauche, environnement interactif à droite, sur un exercice réel du LMS. Elle sert de démo, et le LMS pourra l'intégrer.
3. **Au rapport de la V0** :
   - relire, compléter les tests, construire l'index ;
   - créer le projet Vercel et déployer ;
   - poser les variables d'environnement (AGENTIC_SECRET sans l'afficher) ;
   - tester en réel (sante, ask, complete, latences, refus) ;
   - donner à la conversation du LMS l'URL du service (le secret, Marouan le pose lui-même dans le projet du LMS, ou on le fait sans l'afficher) ;
   - documenter.
4. Ensuite, la livraison 2 de ROADMAP.md.
