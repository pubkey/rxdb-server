import assert from 'assert';

import {
    randomToken
} from 'rxdb/plugins/core';
import {
    createRxServer,
    type RxServerAuthHandler
} from '../../plugins/server';
import {
    createRestClient
} from '../../plugins/client-rest';
import {
    humansCollection,
    HumanDocumentType,
    schemaObjects
} from 'rxdb/plugins/test-utils';
import { waitUntil } from 'async-test-util';
import { nextPort } from './test-helpers.ts';

import config from './config.ts';
import { AuthType, headers } from './test-helpers.ts';
import { TEST_SERVER_ADAPTER } from './config-server.test.ts';

/**
 * A focused performance test that measures the overhead introduced by
 * re-invoking the authHandler on every stream emission.
 * Runs a configurable number of changes through a /query/observe stream
 * and reports both the number of authHandler invocations and
 * the wall-clock duration.
 */
describe('performance-auth.test.ts', () => {
    assert.ok(config);
    const CHANGE_COUNT = 200;

    it('perf: authHandler invocations during streaming /query/observe', async function () {
        this.timeout(60 * 1000);
        const col = await humansCollection.create(0);
        const port = await nextPort();

        let authCallCount = 0;
        let totalAuthTimeMs = 0;
        const authHandler: RxServerAuthHandler<AuthType> = async (requestHeaders) => {
            const start = Date.now();
            // Simulate realistic auth work (e.g., token verification).
            await new Promise(res => setTimeout(res, 1));
            const result = {
                // keep validity far in the future so no real re-auth is required
                validUntil: Date.now() + 10 * 60 * 1000,
                data: {
                    userid: (requestHeaders.userid as string) || 'default'
                }
            };
            authCallCount++;
            totalAuthTimeMs += Date.now() - start;
            if (requestHeaders.authorization !== 'is-valid') {
                throw new Error('auth not valid');
            }
            return result;
        };

        const server = await createRxServer({
            adapter: TEST_SERVER_ADAPTER,
            database: col.database,
            authHandler,
            port
        });
        const endpoint = await server.addRestEndpoint({
            name: randomToken(10),
            collection: col
        });
        await server.start();

        const client = createRestClient<HumanDocumentType>(
            'http://localhost:' + port + '/' + endpoint.urlPath,
            headers
        );

        const emitted: HumanDocumentType[][] = [];
        client.observeQuery({}).subscribe(result => emitted.push(result));
        await waitUntil(() => emitted.length === 1);

        const runStart = Date.now();
        for (let i = 0; i < CHANGE_COUNT; i++) {
            await col.insert(schemaObjects.humanData('p' + i, 1, headers.userid));
        }
        await waitUntil(() => emitted.length >= CHANGE_COUNT + 1, 30000);
        const runMs = Date.now() - runStart;

        // Report metrics so they show up in the test output.
        // eslint-disable-next-line no-console
        console.log(
            '    [perf] /query/observe  ' +
            'changes=' + CHANGE_COUNT + '  ' +
            'authHandler calls=' + authCallCount + '  ' +
            'auth total time(ms)=' + totalAuthTimeMs + '  ' +
            'stream total time(ms)=' + runMs
        );

        // Sanity check: at least the initial call must have happened.
        assert.ok(authCallCount >= 1);
        await col.database.close();
    });
});
