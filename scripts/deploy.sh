#!/usr/bin/env bash
# Déploie Agentic Learning sur Vercel (équipe datarockstars, projet app-agentic-learning). NE PAS lancer sans accord.
#
#   bash scripts/deploy.sh            # production
#   bash scripts/deploy.sh --preview  # déploiement de prévisualisation
#
# Vercel refuse un déploiement dont l'auteur du dernier commit n'est pas membre de l'équipe
# (MarouanGit n'en fait pas partie) : on déploie donc une copie du dossier SANS .git.
# Le SHA du commit est conservé dans la métadonnée « commit » du déploiement.
#
# Ce qui part : le code, public/, et l'index construit en local (data/index/, jamais l'export brut ni le cache).
# Ce qui ne part pas : data/export, data/cache, models/ (téléchargés au build par scripts/telecharger-modeles.ts,
# révisions épinglées), node_modules, .env*.
#
# Prérequis :
#   - CLI Vercel connectée au compte tech backoffice (npx --yes vercel@65.1.0 whoami) ;
#   - index construit : npm run index (data/index/manifeste.json) ;
#   - variable AGENTIC_SECRET posée dans le projet (vercel env add AGENTIC_SECRET production, valeur jamais affichée) ;
#   - fonctions > 250 Mo : « large functions » (projet neuf : actif par défaut ; sinon VERCEL_SUPPORT_LARGE_FUNCTIONS=1).
set -euo pipefail

VERCEL="npx --yes vercel@65.1.0"
SCOPE="datarockstars"
PROJECT="app-agentic-learning"
DOMAIN="${AGENTIC_DOMAIN:-}" # alias de production facultatif (ex. agentic-learning-drs.vercel.app)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo inconnu)"
PROD="--prod"
[ "${1:-}" = "--preview" ] && PROD=""

[ -f "$ROOT/data/index/manifeste.json" ] || { echo "✗ Index absent : lancer d'abord « npm run index »." >&2; exit 1; }
if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then
  echo "⚠ Des modifications ne sont pas commitées : elles seront déployées quand même." >&2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
rsync -a --exclude .git --exclude node_modules --exclude '.env*' --exclude /models --exclude /data/export --exclude /data/cache \
  --exclude '/eval/resultats*.json' --exclude .vercel "$ROOT/" "$TMP/app/"
cd "$TMP/app"

$VERCEL link --yes --project "$PROJECT" --scope "$SCOPE" >/dev/null
# La CLI peut répondre en texte ou en JSON selon le terminal : on extrait l'adresse du déploiement.
OUT="$($VERCEL deploy $PROD --yes --scope "$SCOPE" --meta commit="$SHA" 2>&1)" || { echo "$OUT" >&2; exit 1; }
URL="$(printf '%s' "$OUT" | grep -oE "https://$PROJECT-[a-z0-9]+-$SCOPE\.vercel\.app" | head -n 1)"
[ -n "$URL" ] || { echo "$OUT" >&2; echo "✗ Adresse du déploiement introuvable dans la sortie de la CLI." >&2; exit 1; }
echo "Déployé : $URL"

if [ -n "$PROD" ] && [ -n "$DOMAIN" ]; then
  $VERCEL alias set "$URL" "$DOMAIN" --scope "$SCOPE" >/dev/null 2>&1 || echo "⚠ Alias $DOMAIN non appliqué (vérifier dans Vercel)." >&2
  echo "Production : https://$DOMAIN/api/sante"
fi
