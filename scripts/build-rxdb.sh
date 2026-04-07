#!/bin/bash
set -e

# When rxdb is installed from GitHub, npm strips the config/ directory
# (listed in rxdb's .npmignore). We need to restore it before building.
RXDB_DIR="node_modules/rxdb"

if [ ! -d "$RXDB_DIR" ]; then
  echo "Error: $RXDB_DIR does not exist"
  exit 1
fi

# Restore config/tsconfig.types.json needed by build:types
mkdir -p "$RXDB_DIR/config"
if [ ! -f "$RXDB_DIR/config/tsconfig.types.json" ]; then
  cat > "$RXDB_DIR/config/tsconfig.types.json" << 'TSCONFIG'
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

(cd "$RXDB_DIR" && npm run build)
