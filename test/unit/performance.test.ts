import assert from 'assert';
import {
    createRxDatabase,
    randomToken
} from 'rxdb/plugins/core';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import {
    performanceTest,
    type PerformanceTestResult
} from '../../plugins/server';
import { nextPort } from './test-helpers.ts';
import { TEST_SERVER_ADAPTER } from './config-server.test.ts';
import config from './config.ts';

describe('performance.test.ts', () => {
    assert.ok(config);
    it('should run performance tests for the Express adapter', async function () {
        this.timeout(60 * 1000);

        const results: PerformanceTestResult[] = await performanceTest({
            adapter: TEST_SERVER_ADAPTER,
            createDatabase: async () => {
                const db = await createRxDatabase({
                    name: 'perfdb-' + randomToken(6),
                    storage: wrappedValidateAjvStorage({ storage: getRxStorageMemory() })
                });
                return db;
            },
            getPort: nextPort,
            batchSize: 30
        });

        // Log results for visibility
        console.log('\n--- Performance Test Results (Express adapter) ---');
        for (const r of results) {
            console.log(
                `  ${r.name}: ${r.timeMs.toFixed(1)}ms` +
                ` (${r.opsPerSecond} ops/sec)`
            );
        }
        console.log('---------------------------------------------------\n');

        // Basic sanity checks — every test must complete and produce results
        assert.ok(results.length >= 6, 'Expected at least 6 test results');
        for (const r of results) {
            assert.ok(r.timeMs > 0, r.name + ' should have a positive timeMs');
            assert.ok(r.opsCount > 0, r.name + ' should have a positive opsCount');
            assert.ok(r.opsPerSecond > 0, r.name + ' should have a positive opsPerSecond');
        }
    });
});
