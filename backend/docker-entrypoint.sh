#!/bin/sh
set -e

upload_dir="${UPLOAD_DIR:-/app/data/uploads}"
export_dir="${EXPORT_DIR:-/app/data/exports}"

for dir in "$upload_dir" "$export_dir"; do
  if [ -n "$dir" ]; then
    mkdir -p "$dir"
    chown -R node:node "$dir"
  fi
done

exec su-exec node "$@"
