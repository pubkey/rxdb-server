import assert from 'assert';

import {
    RxCollection,
    RxJsonSchema,
    createRxDatabase,
    randomToken
} from 'rxdb/plugins/core';
import {
    createRxServer
} from '../../plugins/server';
import {
    replicateServer
} from '../../plugins/replication-server';
import {
    ensureReplicationHasNoErrors,
    isFastMode
} from 'rxdb/plugins/test-utils';
import { EventSource } from 'eventsource';

import config from './config.ts';
import { nextPort } from './test-helpers.ts';
import { authHandler, headers } from './test-helpers.ts';
import { TEST_SERVER_ADAPTER } from './config-server.test.ts';

type PerfDocType = {
    id: string;
    counter: number;
    payload: string;
    serverSecret?: string;
};
const perfSchema: RxJsonSchema<PerfDocType> = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        counter: { type: 'integer', minimum: 0, maximum: 1_000_000, multipleOf: 1 },
        payload: { type: 'string', maxLength: 200 },
        serverSecret: { type: 'string', maxLength: 200 }
    },
    required: ['id', 'counter', 'payload']
};

async function createCol(): Promise<RxCollection<PerfDocType>> {
    const db = await createRxDatabase<{ items: RxCollection<PerfDocType> }>({
        name: randomToken(10),
        storage: config.storage.getStorage(),
        multiInstance: false
    });
    const cols = await db.addCollections({
        items: { schema: perfSchema }
    });
    return cols.items;
}

describe('performance.test.ts', () => {
    const DOC_COUNT = isFastMode() ? 25 : 100;
    const RUNS = isFastMode() ? 3 : 5;

    it('push/pull replication with serverOnlyFields - measure baseline throughput', async function () {
        this.timeout(120 * 1000);

        const timings: number[] = [];

        for (let run = 0; run < RUNS; run++) {
            const serverCol = await createCol();
            const port = await nextPort();
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: serverCol.database,
                authHandler,
                port
            });
            const endpoint = await server.addReplicationEndpoint<PerfDocType>({
                name: randomToken(10),
                collection: serverCol,
                serverOnlyFields: ['serverSecret']
            });
            await server.start();

            // Seed the server with docs that have the server-only field set.
            const seed: PerfDocType[] = [];
            for (let i = 0; i < DOC_COUNT; i++) {
                seed.push({
                    id: 'doc-' + i,
                    counter: 0,
                    payload: 'payload-' + i,
                    serverSecret: 'secret-' + i
                });
            }
            await serverCol.bulkInsert(seed);

            const clientCol = await createCol();
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath;
            const replicationState = replicateServer<PerfDocType>({
                collection: clientCol,
                replicationIdentifier: randomToken(10),
                url,
                headers,
                live: true,
                push: {},
                pull: {},
                eventSource: EventSource
            });
            ensureReplicationHasNoErrors(replicationState);

            const start = Date.now();
            await replicationState.awaitInSync();

            const clientDocs = await clientCol.find().exec();
            await Promise.all(clientDocs.map(d => d.patch({ counter: 1 })));
            await replicationState.awaitInSync();

            const elapsed = Date.now() - start;
            timings.push(elapsed);

            // Sanity: server must reflect every update.
            const serverDocs = await serverCol.find().exec();
            assert.strictEqual(serverDocs.length, DOC_COUNT);
            for (const d of serverDocs) {
                assert.strictEqual(d.counter, 1);
                assert.strictEqual(typeof d.serverSecret, 'string');
            }

            await replicationState.cancel();
            await server.close();
            await serverCol.database.close();
            await clientCol.database.close();
        }

        timings.sort((a, b) => a - b);
        const min = timings[0];
        const max = timings[timings.length - 1];
        const median = timings[Math.floor(timings.length / 2)];
        const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
        console.log(
            '        [perf] replication roundtrip (pull+push) for ' + DOC_COUNT + ' docs x ' + RUNS + ' runs: '
            + 'min=' + min + 'ms median=' + median + 'ms avg=' + avg.toFixed(1) + 'ms max=' + max + 'ms'
        );
    });
});
