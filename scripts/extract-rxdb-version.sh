#!/bin/bash
set -e

RXDB_VERSION=$(node -e "console.log(require('../package.json').peerDependencies.rxdb)")
