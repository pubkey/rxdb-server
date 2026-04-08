#!/bin/bash
set -e

# When rxdb is installed from a GitHub tarball, dist/ is not included
# (it's gitignored in the rxdb repo). We install devDependencies, then build.
RXDB_DIR="node_modules/rxdb"

if [ ! -d "$RXDB_DIR" ]; then
  echo "Error: $RXDB_DIR does not exist"
  exit 1
fi

cd "$RXDB_DIR"

# Install all devDependencies of rxdb so the build can succeed
npm install

# Deduplicate: remove nested packages that already exist at the root
# node_modules with the same version. This prevents TypeScript from
# generating non-portable paths like 'rxdb/node_modules/mingo/types'
# during declaration emit (TS2742).
cd ..
for nested in rxdb/node_modules/*/; do
  pkg=$(basename "$nested")
  if [ -d "$pkg" ]; then
    nested_ver=$(node -p "try{require('./rxdb/node_modules/$pkg/package.json').version}catch(e){''}" 2>/dev/null)
    root_ver=$(node -p "try{require('./$pkg/package.json').version}catch(e){''}" 2>/dev/null)
    if [ -n "$nested_ver" ] && [ "$nested_ver" = "$root_ver" ]; then
      rm -rf "$nested"
    fi
  fi
done
cd rxdb

npm run build
