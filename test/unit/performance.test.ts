import assert from 'assert';
import {
    randomToken
} from 'rxdb/plugins/core';
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
import { nextPort } from './test-helpers.ts';

import config from './config.ts';
import {
    authHandler,
    headers,
    queryModifier
} from './test-helpers.ts';
import { TEST_SERVER_ADAPTER } from './config-server.test.ts';

/**
 * Performance tests for the REST endpoint.
 * These tests benchmark the hot paths that apply the queryModifier.
 * The numbers are printed to stdout so they can be compared
 * before and after a code change.
 */
describe('performance.test.ts', () => {
    assert.ok(config);

    /**
     * How many iterations each benchmark should run.
     * A single number keeps the results stable across machines
     * while still being sensitive enough to spot regressions.
     */
    const ITERATIONS = 200;

    it('/query with queryModifier', async () => {
        const col = await humansCollection.create(0);
        // seed a realistic amount of documents with a mix of owners
        const docs: HumanDocumentType[] = [];
        for (let i = 0; i < 50; i++) {
            docs.push(schemaObjects.humanData(undefined, 1, i % 2 === 0 ? headers.userid : 'other'));
        }
        await col.bulkInsert(docs);

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

        // warm-up to avoid cold-start noise
        await client.query({ selector: {} });

        const start = Date.now();
        for (let i = 0; i < ITERATIONS; i++) {
            const res = await client.query({ selector: {} });
            assert.ok(res.documents.length > 0);
        }
        const duration = Date.now() - start;
        console.log('# PERF /query with queryModifier: ' + ITERATIONS + ' iterations in ' + duration + 'ms (' + (duration / ITERATIONS).toFixed(3) + 'ms/op)');

        await col.database.close();
    });

    it('/set with queryModifier (update path)', async () => {
        const col = await humansCollection.create(0);
        // seed documents all owned by the authenticated user
        const seedIds: string[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
            const id = 'doc-' + i;
            seedIds.push(id);
            await col.insert(schemaObjects.humanData(id, 1, headers.userid));
        }

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

        const start = Date.now();
        for (let i = 0; i < ITERATIONS; i++) {
            await client.set([{
                passportId: seedIds[i],
                firstName: headers.userid,
                lastName: 'perf',
                age: (i % 100) + 10
            } as HumanDocumentType]);
        }
        const duration = Date.now() - start;
        console.log('# PERF /set with queryModifier: ' + ITERATIONS + ' iterations in ' + duration + 'ms (' + (duration / ITERATIONS).toFixed(3) + 'ms/op)');

        await col.database.close();
    });
});
