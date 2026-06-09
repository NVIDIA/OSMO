#!/usr/bin/env bash
set -euo pipefail

workspace="${1:-/workspace}"
repo_source="${2:-/workspace/input/repo}"
repo_target="${workspace}/repo"

rm -rf "${repo_target}"
mkdir -p "${repo_target}"
cp -R "${repo_source}/." "${repo_target}/"

git -C "${repo_target}" init -q
git -C "${repo_target}" config user.email "eval@example.com"
git -C "${repo_target}" config user.name "Eval Fixture"
git -C "${repo_target}" add .
git -C "${repo_target}" commit -qm "chore: seed sample osmo service values"
