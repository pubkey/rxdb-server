import assert from 'assert';

import {
    RxDocumentData,
    addRxPlugin,
    overwritable,
    randomToken,
} from "rxdb/plugins/core";
import {
    createRxServer,
    doesContainRegexQuerySelector,
    mergeServerDocumentFieldsMonad
} from '../../plugins/server';
import {
    humansCollection
} from 'rxdb/plugins/test-utils';
import { nextPort } from './test-helpers.ts';
import { RxDBMigrationPlugin } from 'rxdb/plugins/migration-schema';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';

import config from './config.ts';
import { authHandler } from './test-helpers.ts';
import { TEST_SERVER_ADAPTER } from './config-server.test.ts';

/**
 * exit with non-zero on unhandledRejection
 */
process.on('unhandledRejection', async function (error, p) {
    console.log('init.test.js: unhandledRejection');

    // use log and error because some CI terminals do not show errors.
    try {
        console.dir(await p);
    } catch (err) {
        console.log((error as any).stack);
        console.dir(error);
        console.log('------- COULD NOT AWAIT p');
        process.exit(5);
    }
    console.dir((error as any).stack);
    console.error(error);
    console.dir(error);
    console.log('------- END OF unhandledRejection debug logs');
    process.exit(5);
});

describe('server.test.ts', () => {
    describe('init', () => {
        it('init', async () => {
            addRxPlugin(RxDBDevModePlugin);
            addRxPlugin(RxDBMigrationPlugin);
            addRxPlugin(RxDBLeaderElectionPlugin);

            assert.ok(overwritable.isDevMode());
            assert.ok(config);
            if (config.storage.init) {
                await config.storage.init();
            }
        });
    });
    describe('basics', () => {
        it('should start end stop the server', async () => {
            const port = await nextPort();
            const col = await humansCollection.create(0);
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler,
                port
            });
            assert.ok(server);
            await col.database.close();
        });

        it("should apply CORS", async () => {
            const port = await nextPort();
            const col = await humansCollection.create(0);
            const cors = `http://localhost:${port}`;
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler,
                port,
                cors,
            });
            const endpoint = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col,
            });
            await server.start();
            
            const get = `http://localhost:${port}/${endpoint.urlPath}/query`;
            const post = `http://localhost:${port}/${endpoint.urlPath}/push`;
            const getRes = await fetch(get);
            const postRes = await fetch(post, {
                method: "POST",
            });
            const optionsRes = await fetch(post, {
                method: "OPTIONS",
            });
            assert.strictEqual(getRes.headers.get("access-control-allow-origin"), cors);
            assert.strictEqual(postRes.headers.get("access-control-allow-origin"), cors);
            assert.strictEqual(optionsRes.headers.get("access-control-allow-origin"), cors);

            server.close();
            col.database.close();
        });
        it('should reflect the request Origin when cors is set to wildcard', async () => {
            const port = await nextPort();
            const col = await humansCollection.create(0);
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler,
                port,
                cors: '*',
            });
            const endpoint = server.addRestEndpoint({
                name: randomToken(10),
                collection: col,
            });
            await server.start();

            const requestOrigin = 'http://example.com';
            const url = `http://localhost:${port}/${endpoint.urlPath}/query`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Origin': requestOrigin,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ selector: {} }),
            });

            /**
             * When credentials are enabled (which is always the case),
             * Access-Control-Allow-Origin must NOT be '*' because
             * browsers reject wildcard origins with credentials.
             * Instead, the server must reflect the request's Origin.
             */
            assert.strictEqual(
                res.headers.get('access-control-allow-origin'),
                requestOrigin,
                'Access-Control-Allow-Origin must reflect the request Origin, not use wildcard, when credentials are enabled'
            );
            assert.strictEqual(
                res.headers.get('access-control-allow-credentials'),
                'true'
            );

            server.close();
            await col.database.close();
        });
        it('should add multiple endpoints', async () => {
            const port = await nextPort();
            const col = await humansCollection.create(0);
            const cors = `http://localhost:${port}`;
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler,
                port,
                cors,
            });
            const endpoint = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col,
            });
            const endpoint2 = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col,
            });
            const endpoint3 = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col,
            });
            await server.start();
            
            const get = `http://localhost:${port}/${endpoint.urlPath}/query`;
            const post = `http://localhost:${port}/${endpoint.urlPath}/push`;
            const getRes = await fetch(get);
            const postRes = await fetch(post, {
                method: "POST",
            });
            const optionsRes = await fetch(post, {
                method: "OPTIONS",
            });
            assert.strictEqual(getRes.headers.get("access-control-allow-origin"), cors);
            assert.strictEqual(postRes.headers.get("access-control-allow-origin"), cors);
            assert.strictEqual(optionsRes.headers.get("access-control-allow-origin"), cors);

            server.close();
            col.database.close();
        });
    });
    describe('.doesContainRegexQuerySelector()', () => {
        it('should return false', () => {
            assert.strictEqual(doesContainRegexQuerySelector({ selector: { foo: { $eq: 'bar' } } }), false);
            assert.strictEqual(doesContainRegexQuerySelector({ selector: {} }), false);
        });
        it('should return true', () => {
            assert.strictEqual(doesContainRegexQuerySelector({ selector: { foo: { $regex: 'bar' } } }), true);
            assert.strictEqual(doesContainRegexQuerySelector({ selector: { $regex: 'bar' } }), true);
        });
    });
    describe('.mergeServerDocumentFieldsMonad()', () => {
        it('should merge the documents', () => {
            const serverDoc: RxDocumentData<{ id: string, private: string }> = {
                _attachments: {},
                _deleted: false,
                _meta: {
                    lwt: 2000
                },
                _rev: '1-rev',
                id: 'foobar',
                private: 'barfoo'
            };
            const result = mergeServerDocumentFieldsMonad<any>(['private'])({ id: 'foobar' }, serverDoc);
            assert.strictEqual(result.private, 'barfoo');
            assert.strictEqual(result.id, 'foobar');
        });
        it('should not add server-only fields when serverDoc is undefined (new document)', () => {
            const clientDoc = { id: 'foobar' };
            const result = mergeServerDocumentFieldsMonad<any>(['private'])(clientDoc, undefined);

            assert.strictEqual('private' in result, false);
            assert.strictEqual(result.id, 'foobar');
            // Must not mutate the original
            assert.strictEqual('private' in clientDoc, false);
        });
        it('should return falsy clientDoc as-is without transforming it', () => {
            const merge = mergeServerDocumentFieldsMonad<any>(['private']);
            const result = merge(undefined as any, undefined);
            assert.strictEqual(result, undefined);
        });
        it('should not create undefined properties when serverDoc lacks the field', () => {
            // Simulates: document was created via push without the server-only field,
            // stored in DB without it, then a subsequent push references it as serverDoc
            const serverDoc: any = {
                _attachments: {},
                _deleted: false,
                _meta: { lwt: 2000 },
                _rev: '1-rev',
                id: 'foobar',
                // note: no 'private' field at all
            };
            const clientDoc = { id: 'foobar' };
            const result = mergeServerDocumentFieldsMonad<any>(['private'])(clientDoc, serverDoc);

            // Must be null, not undefined
            assert.strictEqual(result.private, null);
            // Must survive JSON roundtrip (undefined would be stripped)
            assert.strictEqual(JSON.parse(JSON.stringify(result)).private, null);
        });
        it('should not cause false conflicts with deepEqual when server-only field is missing from stored doc', () => {
            const merge = mergeServerDocumentFieldsMonad<any>(['private']);

            const storedDoc: any = { id: 'foobar', name: 'test', _deleted: false };
            // ^ no 'private' — was stored via push without server-only field

            const clientAssumedMaster = { id: 'foobar', name: 'test', _deleted: false };
            const mergedAssumed = merge(clientAssumedMaster, storedDoc);

            // Simulate what writeDocToDocState returns (the raw stored doc without _meta/_rev)
            const masterState = { id: 'foobar', name: 'test', _deleted: false };

            // BUG: with the old code, this fails because mergedAssumed has
            // { ..., private: undefined } (4 keys) vs masterState (3 keys)
            assert.strictEqual(
                Object.keys(mergedAssumed).length === Object.keys(masterState).length + 1,
                true,
                'merged doc should have exactly one extra key (the server-only field)'
            );
            assert.strictEqual(
                Object.values(mergedAssumed).every(v => v !== undefined),
                true,
                'no property should be undefined (breaks deepEqual key count)'
            );
        });
    });
});
