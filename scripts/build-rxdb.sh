#!/bin/bash
set -e

# When rxdb is installed from GitHub, npm strips the config/ directory
# (listed in rxdb's .npmignore) and devDependencies are not installed.
# We restore the config, install devDependencies, then build.
RXDB_DIR="node_modules/rxdb"

if [ ! -d "$RXDB_DIR" ]; then
  echo "Error: $RXDB_DIR does not exist"
  exit 1
fi

cd "$RXDB_DIR"

# Restore config/tsconfig.types.json (stripped by .npmignore)
mkdir -p config
if [ ! -f config/tsconfig.types.json ]; then
  cat > config/tsconfig.types.json << 'TSCONFIG'
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "../dist/types",
    "declaration": true,
    "emitDeclarationOnly": true,
    "declarationMap": false,
    "stripInternal": true,
    "noEmit": false,
    "types": []
  },
  "include": [
    "../src"
  ],
  "exclude": []
}
TSCONFIG
fi

# Install all devDependencies of rxdb so the build can succeed
npm install

npm run build
