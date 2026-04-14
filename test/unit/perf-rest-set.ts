/**
 * Micro-benchmark for the REST /set endpoint.
 * Measures the wall-time of bulk /set requests which hit the path
 * that was changed by the overwrite-protection fix.
 *
 * Run with:
 *   npx ts-node --esm ./test/unit/perf-rest-set.ts
 * or
 *   npx mocha --require ts-node/register ./test/unit/perf-rest-set.ts --exit
 */
import {
    addRxPlugin,
    randomToken
} from 'rxdb/plugins/core';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import {
    createRxServer
} from '../../plugins/server';
import {
    createRestClient
} from '../../plugins/client-rest';
import {
    humansCollection,
    HumanDocumentType
} from 'rxdb/plugins/test-utils';
import { nextPort } from './test-helpers.ts';

import './config.ts';
import {
    authHandler,
    headers,
    queryModifier
} from './test-helpers.ts';
import { TEST_SERVER_ADAPTER } from './config-server.test.ts';

async function run() {
    addRxPlugin(RxDBDevModePlugin);

    const totalDocs = 500;
    const batches = 5;
    const perBatch = totalDocs / batches;

    const col = await humansCollection.create(0);

    // seed docs owned by the authenticated user so they pass the queryModifier
    const seed: HumanDocumentType[] = [];
    for (let i = 0; i < totalDocs; i++) {
        seed.push({
            passportId: 'doc-' + i,
            firstName: headers.userid,
            lastName: 'seed',
            age: 20
        });
    }
    await col.bulkInsert(seed);

    const port = await nextPort();
    const server = await createRxServer({
        adapter: TEST_SERVER_ADAPTER,
        database: col.database,
        authHandler,
        port
    });
    const endpoint = await server.addRestEndpoint({
        name: randomToken(10),
        collection: col,
        queryModifier
    });
    await server.start();

    const client = createRestClient<HumanDocumentType>(
        'http://localhost:' + port + '/' + endpoint.urlPath,
        headers
    );

    // warmup
    await client.set([{
        passportId: 'doc-0',
        firstName: headers.userid,
        lastName: 'warm',
        age: 1
    }]);

    const start = Date.now();
    for (let b = 0; b < batches; b++) {
        const batch: HumanDocumentType[] = [];
        for (let i = 0; i < perBatch; i++) {
            const idx = b * perBatch + i;
            batch.push({
                passportId: 'doc-' + idx,
                firstName: headers.userid,
                lastName: 'u' + b,
                age: 30 + (idx % 10)
            });
        }
        await client.set(batch);
    }
    const ms = Date.now() - start;

    console.log('# perf-rest-set: updated ' + totalDocs + ' docs in ' + ms + 'ms (' + (totalDocs / (ms / 1000)).toFixed(1) + ' docs/sec)');

    await server.close();
    await col.database.close();
}

run().then(
    () => process.exit(0),
    err => { console.error(err); process.exit(1); }
);
