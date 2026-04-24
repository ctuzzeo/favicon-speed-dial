#!/usr/bin/env bash
# Create github.com/<you>/favicon-speed-dial and push this repository to it.
# Prerequisites: brew install gh && gh auth login
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO_NAME="favicon-speed-dial"
DESCRIPTION="Favicon Speed Dial — new tab extension (fork lineage from Easy Speed Dial)"

if ! gh auth status &>/dev/null; then
  echo "You are not logged into GitHub CLI."
  echo "Run this once, complete the prompts, then re-run this script:"
  echo "  gh auth login"
  exit 1
fi

LOGIN="$(gh api user -q .login)"
FULL_NAME="${LOGIN}/${REPO_NAME}"
NEW_URL="https://github.com/${FULL_NAME}.git"

echo "GitHub user: ${LOGIN}"
echo "Target repo: ${FULL_NAME}"

if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "Note: you have uncommitted changes; only committed work will be pushed."
fi

if gh repo view "${FULL_NAME}" &>/dev/null; then
  echo "Repository already exists on GitHub."
else
  echo "Creating empty public repository ${REPO_NAME}…"
  gh repo create "${REPO_NAME}" --public --description "${DESCRIPTION}"
fi

if git remote get-url favicon &>/dev/null; then
  echo "Updating remote favicon → ${NEW_URL}"
  git remote set-url favicon "${NEW_URL}"
else
  echo "Adding remote favicon → ${NEW_URL}"
  git remote add favicon "${NEW_URL}"
fi

echo "Pushing all local branches and tags to favicon…"
git push -u favicon --all
git push favicon --tags

echo
echo "Done. New remote: favicon → ${NEW_URL}"
echo "Optional: make it your default push target:"
echo "  git remote rename origin easy-speed-dial-fork"
echo "  git remote rename favicon origin"
echo "Or keep both remotes and use: git push favicon <branch>"
