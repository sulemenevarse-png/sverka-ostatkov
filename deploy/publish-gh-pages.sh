#!/bin/sh
# Собирает сайт и публикует готовую сборку в ветку gh-pages репозитория origin.
# Запуск: npm run deploy:pages
set -eu

REPO_URL=$(git remote get-url origin)
REPO_NAME=$(basename "$REPO_URL" .git)
OWNER=$(printf '%s' "$REPO_URL" | sed -E 's#.*github\.com[:/]([^/]+)/.*#\1#')

npm test
npm audit --audit-level=high
SITE_URL="https://$OWNER.github.io" BASE_PATH="/$REPO_NAME" npm run build

# Без этого файла GitHub пропустит папку _astro со скриптами и стилями (папки на «_» Jekyll игнорирует)
touch dist/.nojekyll

# Публикуем dist/ отдельной историей, не трогая рабочую папку
cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name)" -c user.email="$(git -C .. config user.email)" \
  commit -q -m "Сборка сайта от $(date '+%Y-%m-%d %H:%M')"
git push -q -f "$REPO_URL" gh-pages
rm -rf .git
echo "Готово: https://$OWNER.github.io/$REPO_NAME/ (обновится через 1–2 минуты)"
