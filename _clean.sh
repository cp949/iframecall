#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

remove_path() {
  local target="$1"

  if [ -e "$target" ]; then
    echo "remove ${target#$ROOT_DIR/}"
    rm -rf "$target"
  fi
}

for name in node_modules .turbo .next dist build out coverage; do
  remove_path "$ROOT_DIR/$name"
done

for app_dir in "$ROOT_DIR"/demo; do
  [ -d "$app_dir" ] || continue

  for name in node_modules .turbo .next dist build out coverage; do
    remove_path "$app_dir/$name"
  done
done

for package_dir in "$ROOT_DIR"/packages/*; do
  [ -d "$package_dir" ] || continue

  for name in node_modules .turbo .next dist build out coverage; do
    remove_path "$package_dir/$name"
  done
done
