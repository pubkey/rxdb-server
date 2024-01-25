#!/bin/bash
set -e

source extract-rxdb-version.sh
echo RXDB_VERSION=$RXDB_VERSION


cd ../

npm run build
npm run build:bundle
rimraf -rf ./test-integration

git clone -b ${RXDB_VERSION} https://github.com/pubkey/rxdb.git ./test-integration --depth 1
# git clone https://github.com/pubkey/rxdb.git ./test-integration-$STORAGE --depth 1

# copy test files
cp ./test/unit/*.test.ts ./test-integration/test/unit/
cp ./test/unit/test-helpers.ts ./test-integration/test/unit/
cp ./test/unit.test.ts ./test-integration/test


cp rxdb-server.tgz ./test-integration/rxdb-server.tgz

cd ./test-integration

# replace imports
find test -type f -exec sed -i 's|\.\.\/\.\.\/plugins\/server|rxdb-server/plugins/server|g' {} +
find test -type f -exec sed -i 's|\.\.\/\.\.\/plugins\/replication-server|rxdb-server/plugins/replication-server|g' {} +
find test -type f -exec sed -i 's|\.\.\/\.\.\/plugins\/test-utils\/index\.mjs|rxdb/plugins/test-utils|g' {} +

npm i rxdb@$RXDB_VERSION
npm install ./rxdb-server.tgz
npm i

(cd ./node_modules/rxdb-server/ && npm i)

npm run build
npm run check-types


cd ../
