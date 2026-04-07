#!/bin/bash
set -e

# When rxdb is installed from GitHub, npm strips the config/ directory
# (listed in rxdb's .npmignore) and devDependencies like @types/mocha
# are not installed. We restore the config, create stub type declarations
# for optional peer dependencies, then build.
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

# Create stub type declarations for rxdb's optional peer dependencies
# so that build:types can compile without installing them all.
# Placed in src/ so it is automatically included by tsconfig's include glob.
cat > src/module-stubs.d.ts << 'STUBS'
declare module 'crypto-js';
declare module 'react';
declare module '@angular/core';
declare module '@angular/core/rxjs-interop';
declare module '@preact/signals-core';
declare module 'vue';
declare module 'appwrite';
declare module 'firebase/firestore';
declare module 'mongodb';
declare module 'nats';
declare module '@supabase/supabase-js';
declare module 'rxdb-old';
STUBS

# Create a minimal @types/mocha stub (rxdb's test-utils references it
# as a devDependency, but devDeps aren't installed from GitHub)
mkdir -p node_modules/@types/mocha
cat > node_modules/@types/mocha/index.d.ts << 'MOCHA'
declare function describe(description: string, callback: () => void): void;
declare function it(description: string, callback: () => void): void;
declare function before(callback: () => void): void;
declare function after(callback: () => void): void;
declare function beforeEach(callback: () => void): void;
declare function afterEach(callback: () => void): void;
MOCHA

npm run build
