/**
 * Performance test for REST endpoint operations.
 * Measures throughput of query, get, set, and delete operations.
 */
import {
    addRxPlugin,
    randomToken
} from 'rxdb/plugins/core';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { RxDBMigrationPlugin } from 'rxdb/plugins/migration-schema';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';
import {
    createRxServer
} from '../../plugins/server';
import {
    createRestClient
} from '../../plugins/client-rest';
import {
    schemaObjects,
    humansCollection,
    HumanDocumentType
} from 'rxdb/plugins/test-utils';
import { nextPort, authHandler, headers } from './test-helpers.ts';

import config from './config.ts';
void config;
import { TEST_SERVER_ADAPTER } from './config-server.test.ts';

addRxPlugin(RxDBDevModePlugin);
addRxPlugin(RxDBMigrationPlugin);
addRxPlugin(RxDBLeaderElectionPlugin);

async function runPerformanceTest() {
    console.log('=== RxDB Server Performance Test ===\n');
    const col = await humansCollection.create(0);
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
        serverOnlyFields: ['lastName']
    });
    await server.start();
    const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

    const DOC_COUNT = 50;
    const ITERATIONS = 3;

    // -- Insert docs on server directly for setup --
    const docs: HumanDocumentType[] = [];
    for (let i = 0; i < DOC_COUNT; i++) {
        const d = schemaObjects.humanData();
        docs.push(d);
        await col.insert(d);
    }

    // -- Benchmark: query --
    {
        const times: number[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
            const start = performance.now();
            await client.query({});
            times.push(performance.now() - start);
        }
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`query (${DOC_COUNT} docs):    avg ${avg.toFixed(2)}ms`);
    }

    // -- Benchmark: get --
    {
        const ids = docs.map(d => d.passportId);
        const times: number[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
            const start = performance.now();
            await client.get(ids);
            times.push(performance.now() - start);
        }
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`get (${DOC_COUNT} docs):      avg ${avg.toFixed(2)}ms`);
    }

    // -- Benchmark: set (update) --
    {
        const response = await client.query({});
        const clientDocs = response.documents;
        const times: number[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
            const start = performance.now();
            for (const d of clientDocs.slice(0, 10)) {
                const updated = Object.assign({}, d, { firstName: 'perf-' + i + '-' + randomToken(4) });
                await client.set([updated]);
            }
            times.push(performance.now() - start);
        }
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`set (10 updates):   avg ${avg.toFixed(2)}ms`);
    }

    // -- Benchmark: delete --
    {
        // Insert fresh docs to delete
        const deleteIds: string[] = [];
        for (let i = 0; i < 10; i++) {
            const d = schemaObjects.humanData();
            await col.insert(d);
            deleteIds.push(d.passportId);
        }
        const times: number[] = [];
        const start = performance.now();
        await client.delete(deleteIds);
        times.push(performance.now() - start);
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`delete (10 docs):   avg ${avg.toFixed(2)}ms`);
    }

    console.log('\n=== Done ===');
    await col.database.close();
}

runPerformanceTest().catch(err => {
    console.error(err);
    process.exit(1);
});
