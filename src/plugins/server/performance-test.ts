/**
 * A reusable performance test suite for RxDB server adapters.
 * This function can be exported and used by consumers who
 * create custom adapters to verify their performance characteristics.
 */

import type {
    RxDatabase,
    RxCollection
} from 'rxdb/plugins/core';
import { randomToken } from 'rxdb/plugins/core';
import type { RxServerAdapter } from './types.ts';
import { createRxServer } from './index.ts';
import { createRestClient } from '../client-rest/index.ts';

export type PerformanceTestResult = {
    /** Name of the test case */
    name: string;
    /** Total time in milliseconds */
    timeMs: number;
    /** Number of operations performed */
    opsCount: number;
    /** Calculated operations per second */
    opsPerSecond: number;
};

export type PerformanceTestOptions<ServerAppType> = {
    adapter: RxServerAdapter<ServerAppType, any, any>;
    /**
     * Function that creates a fresh RxDatabase instance.
     * Must return a database that can be closed after each test.
     */
    createDatabase: () => Promise<RxDatabase>;
    /**
     * Function that resolves an available port for the server.
     */
    getPort: () => Promise<number>;
    /**
     * Number of documents to use for each test.
     * [default=30]
     */
    batchSize?: number;
};

/**
 * Simple document schema for performance testing.
 */
type PerfDocType = {
    id: string;
    name: string;
    value: number;
};

const PERF_SCHEMA = {
    version: 0,
    primaryKey: 'id',
    type: 'object' as const,
    properties: {
        id: { type: 'string' as const, maxLength: 100 },
        name: { type: 'string' as const },
        value: { type: 'number' as const }
    },
    required: ['id', 'name', 'value'] as const
};


function generateDocs(count: number): PerfDocType[] {
    const docs: PerfDocType[] = [];
    for (let i = 0; i < count; i++) {
        docs.push({
            id: randomToken(12) + '-' + i,
            name: 'doc-name-' + i + '-' + randomToken(6),
            value: i
        });
    }
    return docs;
}

async function createCollectionWithDocs(
    db: RxDatabase,
    docs: PerfDocType[]
): Promise<RxCollection<PerfDocType>> {
    const colName = 'perf' + randomToken(8).toLowerCase();
    const collections = await db.addCollections({
        [colName]: { schema: PERF_SCHEMA }
    });
    const col = collections[colName];
    if (docs.length > 0) {
        await col.bulkInsert(docs);
    }
    return col;
}

/**
 * Runs a set of performance tests against the given adapter.
 * Each test creates its own server and collection, measures
 * the time for the operations, and tears down afterwards.
 *
 * Returns an array of results that callers can assert against
 * or log for comparison purposes.
 */
export async function performanceTest<ServerAppType>(
    options: PerformanceTestOptions<ServerAppType>
): Promise<PerformanceTestResult[]> {
    const batchSize = options.batchSize ?? 30;
    const results: PerformanceTestResult[] = [];

    // ---------- Test 1: writes via REST /set ----------
    {
        const db = await options.createDatabase();
        const col = await createCollectionWithDocs(db, []);
        const port = await options.getPort();

        const server = await createRxServer({
            adapter: options.adapter,
            database: db,
            port
        });
        const endpoint = await server.addRestEndpoint({
            name: randomToken(10),
            collection: col
        });
        await server.start();

        const client = createRestClient<PerfDocType>(
            'http://localhost:' + port + '/' + endpoint.urlPath,
            {}
        );

        const docs = generateDocs(batchSize);
        const start = performance.now();
        await client.set(docs);
        const timeMs = performance.now() - start;

        results.push({
            name: 'REST /set (bulk write ' + batchSize + ' docs)',
            timeMs,
            opsCount: batchSize,
            opsPerSecond: Math.round((batchSize / timeMs) * 1000)
        });

        await db.close();
    }

    // ---------- Test 2: query via REST /query ----------
    {
        const docs = generateDocs(batchSize);
        const db = await options.createDatabase();
        const col = await createCollectionWithDocs(db, docs);
        const port = await options.getPort();

        const server = await createRxServer({
            adapter: options.adapter,
            database: db,
            port
        });
        const endpoint = await server.addRestEndpoint({
            name: randomToken(10),
            collection: col
        });
        await server.start();

        const client = createRestClient<PerfDocType>(
            'http://localhost:' + port + '/' + endpoint.urlPath,
            {}
        );

        const iterations = 10;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            await client.query({ selector: {} });
        }
        const timeMs = performance.now() - start;

        results.push({
            name: 'REST /query (' + iterations + ' queries, ' + batchSize + ' docs each)',
            timeMs,
            opsCount: iterations,
            opsPerSecond: Math.round((iterations / timeMs) * 1000)
        });

        await db.close();
    }

    // ---------- Test 3: get by IDs via REST /get ----------
    {
        const docs = generateDocs(batchSize);
        const db = await options.createDatabase();
        const col = await createCollectionWithDocs(db, docs);
        const port = await options.getPort();

        const server = await createRxServer({
            adapter: options.adapter,
            database: db,
            port
        });
        const endpoint = await server.addRestEndpoint({
            name: randomToken(10),
            collection: col
        });
        await server.start();

        const client = createRestClient<PerfDocType>(
            'http://localhost:' + port + '/' + endpoint.urlPath,
            {}
        );

        const ids = docs.map(d => d.id);
        const iterations = 10;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            await client.get(ids);
        }
        const timeMs = performance.now() - start;

        results.push({
            name: 'REST /get (' + iterations + ' fetches, ' + batchSize + ' ids each)',
            timeMs,
            opsCount: iterations,
            opsPerSecond: Math.round((iterations / timeMs) * 1000)
        });

        await db.close();
    }

    // ---------- Test 4: delete via REST /delete ----------
    {
        const docs = generateDocs(batchSize);
        const db = await options.createDatabase();
        const col = await createCollectionWithDocs(db, docs);
        const port = await options.getPort();

        const server = await createRxServer({
            adapter: options.adapter,
            database: db,
            port
        });
        const endpoint = await server.addRestEndpoint({
            name: randomToken(10),
            collection: col
        });
        await server.start();

        const client = createRestClient<PerfDocType>(
            'http://localhost:' + port + '/' + endpoint.urlPath,
            {}
        );

        const ids = docs.map(d => d.id);
        const start = performance.now();
        await client.delete(ids);
        const timeMs = performance.now() - start;

        results.push({
            name: 'REST /delete (bulk delete ' + batchSize + ' docs)',
            timeMs,
            opsCount: batchSize,
            opsPerSecond: Math.round((batchSize / timeMs) * 1000)
        });

        await db.close();
    }

    // ---------- Test 5: sequential single-doc writes ----------
    {
        const db = await options.createDatabase();
        const col = await createCollectionWithDocs(db, []);
        const port = await options.getPort();

        const server = await createRxServer({
            adapter: options.adapter,
            database: db,
            port
        });
        const endpoint = await server.addRestEndpoint({
            name: randomToken(10),
            collection: col
        });
        await server.start();

        const client = createRestClient<PerfDocType>(
            'http://localhost:' + port + '/' + endpoint.urlPath,
            {}
        );

        const count = batchSize;
        const start = performance.now();
        for (let i = 0; i < count; i++) {
            await client.set([{
                id: randomToken(12) + '-' + i,
                name: 'seq-' + i,
                value: i
            }]);
        }
        const timeMs = performance.now() - start;

        results.push({
            name: 'REST /set sequential (' + count + ' single-doc writes)',
            timeMs,
            opsCount: count,
            opsPerSecond: Math.round((count / timeMs) * 1000)
        });

        await db.close();
    }

    // ---------- Test 6: replication pull via HTTP ----------
    {
        const docs = generateDocs(batchSize);
        const db = await options.createDatabase();
        const col = await createCollectionWithDocs(db, docs);
        const port = await options.getPort();

        const server = await createRxServer({
            adapter: options.adapter,
            database: db,
            port
        });
        const endpoint = await server.addReplicationEndpoint({
            name: randomToken(10),
            collection: col
        });
        await server.start();

        const url = 'http://localhost:' + port + '/' + endpoint.urlPath;
        const iterations = 10;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
            const response = await fetch(url + '/pull?lwt=0&id=&limit=' + batchSize, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            await response.json();
        }
        const timeMs = performance.now() - start;

        results.push({
            name: 'Replication /pull (' + iterations + ' pulls, ' + batchSize + ' docs each)',
            timeMs,
            opsCount: iterations,
            opsPerSecond: Math.round((iterations / timeMs) * 1000)
        });

        await db.close();
    }

    return results;
}
