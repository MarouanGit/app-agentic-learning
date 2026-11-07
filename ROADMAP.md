# Agentic Learning : les livraisons

Objectif fixé par Marouan le 07/11/2026 : un assistant d'aide à l'apprentissage « comme Optima (optima.io, racheté par DataCamp), mais en beaucoup mieux », livré en plusieurs fois. Service à part, sur sa propre instance Vercel (`app-agentic-learning`), intégré au LMS derrière la fonctionnalité « agentic-learning ».

Ce qu'Optima fait : explications reliées au métier de l'apprenant, retour personnalisé sur chaque réponse, rythme qui accélère ou ralentit, questions d'approfondissement, guidage en direct. Ce qui lui manque et que nous visons : le français, tout un catalogue (langages, skills, bootcamps, masters), des réponses **citées** et des **refus motivés** quand le contenu ne couvre pas la question, les notebooks et les labs, un vrai modèle de maîtrise par notion, et la vue du formateur.

## Livraison 1 · L'assistant qui connaît tout le cours (V0, en cours)
- Une question dans n'importe quelle leçon : réponse en français, fondée sur le contenu du LMS, avec citations cliquables vers les leçons, ou refus motivé (6 portes : pas d'entrée, trop vague, hors programme, rien de citable, contenu retiré, réponse non vérifiée).
- Trois modes : aide, explique autrement, indice (jamais la solution ; solutions et corrigés exclus de l'index).
- Autocomplétion de code (texte fantôme, Tab) dans les éditeurs libres ; jamais dans un exercice noté.
- Modèles open source légers exécutés dans la fonction (Qwen2.5 0.5B, e5-small, ONNX sur CPU), index hors ligne (BM25 + vecteurs + graphe CSR), jeu d'évaluation.

## Livraison 2 · Des explications qui parlent de vous
- Profil de l'apprenant en 3 questions (métier, secteur, objectif) complété par son programme et ses inscriptions.
- « Explique avec un exemple de mon métier » : la notion reformulée dans son secteur (e-commerce, SaaS, santé, finance…), toujours citée.
- Glossaire au survol : un terme du cours, sa définition tirée de la leçon qui l'enseigne.

## Livraison 3 · Un retour sur chaque réponse
- Après une erreur (code Python ou SQL, quiz, étape de lab) : diagnostic de l'erreur, sans la solution, puis indices gradués en 3 niveaux.
- Détection du blocage (échecs répétés, temps passé) : l'assistant propose son aide au bon moment, sans attendre la question.
- « Mon écran ne ressemble pas à ça » dans les labs : l'assistant compare avec la capture attendue et dit quoi faire.

## Livraison 4 · Le rythme qui s'adapte
- Modèle de maîtrise par notion (graphe des concepts × réussites, erreurs et temps).
- Notion maîtrisée : proposition de valider par un mini-test et d'avancer. Notion fragile : micro-leçon de rattrapage et exercices de remédiation tirés du contenu.
- Révisions espacées des notions à consolider (flashcards du LMS).

## Livraison 5 · La vue du formateur
- Les confusions fréquentes par notion et par cohorte ; les questions refusées « hors programme » qui révèlent des leçons manquantes.
- Qualité : taux de réponses citées, refus, latences, coût.

## Livraison 6 · Le guidage sur écran
- L'apprenant colle une capture de son écran (Power BI, claude.ai, Make…) : l'assistant repère où il en est et montre où cliquer, à partir de la banque de captures annotées des labs.

Chaque livraison : tests unitaires et e2e, évaluation chiffrée, déploiement sur l'instance du service, documentation dans app-lms-docs, mémoire.
