# Sécurité et confidentialité — Agentic Learning

## Principes

1. **Pas de hallucination** : les réponses sont basées uniquement sur le contenu du LMS ou refusées
2. **Transparence** : chaque citation est vérifiée et cliquable
3. **Confidentialité** : aucune donnée apprenant n'est loggée au-delà du strict necessaire
4. **Filtrage d'accès** : les réponses respectent les droits de l'apprenant (payant/gratuit)

## Authentification

### Token Bearer

Chaque requête à `/api/*` doit inclure :

```
Authorization: Bearer <AGENTIC_SECRET>
```

`AGENTIC_SECRET` est un secret forte complexité, unique par déploiement (prod/staging/local).

**Gestion** :
- Sur Vercel : configuré comme variable d'environnement (masqué dans les logs)
- Local : lu depuis `.env.local` (gitignoré)
- Jamais affiché en logs ou en production

**Rotation** : tous les 6 mois ou après incident

### Validation du token

```typescript
// api/http.ts
const token = request.headers.get('authorization');
if (!token?.startsWith('Bearer ')) {
  return new Response('Unauthorized', { status: 401 });
}
const secret = token.slice(7);
if (secret !== process.env.AGENTIC_SECRET) {
  return new Response('Forbidden', { status: 403 });
}
```

## Confidentialité des données

### Données loggées

**Ce qui est autorisé à logguer** :
- Métadonnées de la requête : { timestamp, endpoint, latence_ms, porta_refus }
- Seulement si agrégée ou anonymisée

**Ce qui ne doit JAMAIS être loggé** :
- ❌ Contenu de la `question`
- ❌ Token d'authentification
- ❌ Code de l'apprenant (unless explicitement demandé pour debug)
- ❌ ID de l'apprenant (utiliser `autorises` sans log)

### Données persistées

**Base de données** :
- Aucune donnée apprenant persistée
- Index : extraits du LMS uniquement (pas de données personnelles)
- Logs : sur Vercel (retention configurée par Vercel)

**Cache en mémoire** (RAM, Vercel Function) :
- Index chargé au démarrage (non persisté)
- Modèles ONNX chargés au démarrage (non persisté)
- Aucun cache utilisateur

## Filtrage d'accès

### Principe

L'apprenant envoie la liste des cours accessibles (`autorises`). La réponse ne cite QUE les cours de cette liste.

```json
{
  "question": "Comment faire un LEFT JOIN ?",
  "mode": "aide",
  "autorises": ["sql-bases", "python-101"]  // ← apprenant gratuit : pas d'accès Master
}
```

**Comportement** :
- Si la meilleure réponse vient d'un cours non-autorisé → refus « Contenu retiré »
- Si plusieurs cours correspondent → celle la plus pertinente ET autorisée

### Implémentation

```typescript
// src/moteur/priseEnCharge.ts
function filterCitations(citations, autorises) {
  return citations.filter(c => autorises.includes(c.cours));
}
```

### Vérification au déploiement

- ✓ Test e2e : apprenant gratuit n'a pas accès aux réponses Master
- ✓ Test unitaire : filtrage correct des `autorises`
- ✓ Audit : log mensuel des tentatives d'accès refusé

## Contenu exclus de l'index

**Lors de la construction de l'index, on exclut** :

### 1. Solutions et corrigés

```typescript
// scripts/exporter.ts
WHERE contenu.type NOT IN ('solution', 'corrige')
```

**Raison** : l'assistant ne doit jamais donner la solution, même par citation

### 2. Contenu marqué comme retiré

```sql
WHERE contenu.etat NOT IN ('retiré', 'archivé')
```

**Raison** : contenu obsolète ne doit pas être recommandé

### 3. Contenu payant (selon apprenant)

Appliqué à l'**inférence**, pas à l'index :

```typescript
// src/moteur/priseEnCharge.ts
const citations_autorisees = citations.filter(c => 
  autorises.includes(c.cours)
);
```

### 4. Données personnelles

Aucune donnée personnelle n'est exportée du LMS :
- ❌ Réponses d'apprenants (sauf anonymisées pour statistiques)
- ❌ Heures de connexion
- ❌ Historique de notes

## Injection et manipulation

### Prompt injection

**Risque** : apprenant envoie une question qui manipule le prompt système.

**Mitigation** :
- Travailler avec texte brut uniquement, pas d'interpolation de variables
- Utiliser des modèles finetunés avec instructions fixes
- Prompt système non visible à l'apprenant

Exemple sûr :

```typescript
const prompt = `Tu es un tuteur. Réponds basé sur le contenu du LMS.
Question : ${sanitize(question)}
Contexte : ${citations.slice(0, 3).map(c => c.extrait).join('\n\n')}
Mode : ${mode}
`;
```

### Code injection

**Risque** : apprenant envoie du code malveillant dans `/api/complete`.

**Mitigation** :
- Suggestion de code est générée, jamais exécutée
- Modèle Coder entrainé à ne pas proposer d'appels système
- Suggestion limitée à ≤ 50 tokens

### SQL injection

**N'existe pas** : accès au LMS en **lecture seule**, pas d'interpolation SQL côté Agentic Learning

## Traçabilité

### Audit trail (optionnel, pour future livraison)

À chaque appel, persister anonyme :
```json
{
  "timestamp": "2026-11-07T14:32:00Z",
  "endpoint": "/api/ask",
  "porta_refus": null,
  "latence_ms": 50,
  "modele": "Qwen2.5-0.5B-Instruct",
  "taille_reponse_tokens": 87
}
```

**Stockage** : table Neon simple (no PII)
**Retention** : 90 jours
**Accès** : formateurs uniquement (vue agrégée)

### Logs applicatifs

Errors et warnings uniquement :
```typescript
console.error(`[ask] porta_refus=${refus?.porte} latence=${ms}ms`);
```

**Stockage** : Vercel logs (runtime logs)
**Retention** : 7 jours

## Déploiement et maintenance

### Variables d'environnement sensibles

```
AGENTIC_SECRET              # Bearer token
LMS_DATABASE_URL            # (pour build, lecture seule)
VERCEL_DEPLOYMENT_ID        # (auto)
```

**Jamais affichées en console, logs ou interface**

### Mise à jour de l'index

L'index est mis à jour via `npm run index`, qui :
1. ✓ Se connecte au LMS en lecture seule
2. ✓ Exporte les leçons publiques
3. ✓ Exclut solutions, contenu retiré, données personnelles
4. ✓ Construit BM25 + embeddings offline
5. ✓ Déploie sur Vercel (via `deploy.sh`)

**Fréquence** : hebdomadaire (jeudi 2 AM UTC)

**Auditabilité** : chaque index contient un `horodatage` dans `manifeste.json`

## Conformité RGPD

### Données personnelles

- ❌ Aucune donnée d'identification (nom, email, ID apprenant) n'est loggée
- ✓ Questions et réponses sont agrégées, jamais persistées par apprenant
- ✓ L'apprenant peut refuser l'usage des données via opt-out

### Droit à l'oubli

- ✓ Aucune persistance → pas de demande de suppression nécessaire
- ✓ Index reconstruire depuis le LMS (pas d'archive)

### Droit d'accès

- ✓ Les citations sont transparentes et cliquables
- ✓ L'apprenant voit toutes les sources utilisées

## Incidents de sécurité

### Signalement

1. **Découverte** : contactez security@datarockstars.ai
2. **Évaluation** : gravité (basse/haute) et impact (données/indisponibilité)
3. **Fix** : patch dans branche `security/*`, review, merge, déploiement
4. **Disclosure** : rapport post-incident (90 jours après fix)

### Exemples

| Incident | Réponse |
|----------|---------|
| Token exposé sur GitHub | Rotation immédiate, audit des accès antérieurs |
| SQL injection découverte | N/A (accès RO), mais audit du code |
| Hallucination récurrente | Renforcer porte 6 de vérification |
| Données apprenant loggées | Audit logs, suppression, test de regression |

## Checklist avant production

- [ ] Authentification : token configuré, jamais logé
- [ ] Accès LMS : lecture seule uniquement
- [ ] Index : pas de solutions, pas de contenu retiré
- [ ] Filtrage : `autorises` appliqué à la réponse
- [ ] Logs : aucune donnée personnelle
- [ ] HTTPS : forcé sur Vercel
- [ ] CORS : restrictif (LMS uniquement)
- [ ] Rate limiting : actif (max 10 req/s par token)
- [ ] Tests de sécurité : prompt injection, code injection
- [ ] Rotations : secret tous les 6 mois

Voir [exploitation.md](exploitation.md) pour la setup.
