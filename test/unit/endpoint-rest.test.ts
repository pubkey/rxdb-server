import assert from 'assert';

import {
    ensureNotFalsy,
    lastOfArray,
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
    nextPort,
    humansCollection,
    HumanDocumentType
} from 'rxdb/plugins/test-utils';
import { assertThrows, waitUntil } from 'async-test-util';

import config from './config.ts';
import {
    authHandler,
    headers,
    queryModifier
} from './test-helpers.ts';
import { TEST_SERVER_ADAPTER } from './config-server.test.ts';


describe('endpoint-rest.test.ts', () => {
    assert.ok(config);
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
            await server.addRestEndpoint({
                name: randomToken(10),
                collection: col
            });
            await server.start();
            await col.database.close();
        });
        it('should work without auth handler', async () => {
            const port = await nextPort();
            const col = await humansCollection.create(0);
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                port
            });
            await server.addRestEndpoint({
                name: randomToken(10),
                collection: col
            });
            await server.start();
            await col.database.close();
        });
    });
    describe('/query', () => {
        it('should return the correct query results', async () => {
            const col = await humansCollection.create(5);
            const port = await nextPort();
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

            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const response = await client.query({ selector: {} });
            assert.strictEqual(response.documents.length, 5);

            const responseSub = await client.query({
                selector: {
                    passportId: { $eq: response.documents[0].passportId }
                }
            });
            assert.strictEqual(responseSub.documents.length, 1);

            await col.database.close();
        });
        it('should respect the auth header and queryModifier', async () => {
            const col = await humansCollection.create(5);
            await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));
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
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);
            const response = await client.query({ selector: {} });
            assert.strictEqual(response.documents.length, 1);
            assert.strictEqual(response.documents[0].passportId, 'only-matching');

            await col.database.close();
        });
        it('should not allow $regex queries', async () => {
            const col = await humansCollection.create(5);
            await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));
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
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            await assertThrows(
                () => client.query({
                    selector: {
                        firstName: {
                            $regex: 'foobar'
                        }
                    }
                }),
                Error,
                'Bad Request'
            );
            await col.database.close();
        });
        it('should have access-control-allow-credentials set to true', async () => {
            const col = await humansCollection.create(5);
            await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));
            const port = await nextPort();
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler,
                port,
                cors: `http://localhost:${port}`
            });
            const endpoint = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col,
                queryModifier
            });
            await server.start();

            const url = `http://localhost:${port}/${endpoint.urlPath}/query`;

            const fetchResult = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ selector: {} }),
            });

            assert.strictEqual(
                fetchResult.headers.get('access-control-allow-credentials'),
                'true',
                'Expected Access-Control-Allow-Credentials header to be true'
            );

            assert.strictEqual(
                fetchResult.headers.get('access-control-allow-origin'),
                `http://localhost:${port}`,
                'Expected Access-Control-Allow-Origin to match request origin'
            );

            await col.database.close();
        });
    });
    describe('/query/observe', () => {
        it('should return the correct query results', async () => {
            const col = await humansCollection.create(5);
            const port = await nextPort();
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

            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const emitted: HumanDocumentType[][] = [];
            client.observeQuery({}).subscribe(result => emitted.push(result));

            await waitUntil(() => emitted.length === 1);

            await col.insert(schemaObjects.humanData('doc1', 1, headers.userid));
            await waitUntil(() => emitted.length === 2);
            await col.insert(schemaObjects.humanData('doc2', 1, headers.userid));
            await waitUntil(() => emitted.length === 3);

            const last = ensureNotFalsy(lastOfArray(emitted));
            assert.strictEqual(last.length, 7);

            await col.database.close();
        });
        it('should should automatically reconnect', async function () {
            this.timeout(10 * 1000);
            const col = await humansCollection.create(5);
            const port = await nextPort();
            let server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler,
                port
            });
            const endpointName = randomToken(10);
            const endpoint = await server.addRestEndpoint({
                name: endpointName,
                collection: col
            });
            await server.start();

            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const emitted: HumanDocumentType[][] = [];
            client.observeQuery({}).subscribe(result => emitted.push(result));
            await waitUntil(() => emitted.length === 1);

            await server.close();
            await col.insert(schemaObjects.humanData('doc1', 1, headers.userid));

            server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler,
                port
            });
            await server.addRestEndpoint({
                name: endpointName,
                collection: col
            });
            await server.start();

            await waitUntil(() => emitted.length === 2);

            const last = ensureNotFalsy(lastOfArray(emitted));
            assert.strictEqual(last.length, 6);

            await col.database.close();
        });
        it('should respect the auth header and queryModifier', async () => {
            const col = await humansCollection.create(5);
            await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));
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
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const emitted: HumanDocumentType[][] = [];
            client.observeQuery({}).subscribe(result => emitted.push(result));
            await waitUntil(() => emitted.length === 1);

            const last = ensureNotFalsy(lastOfArray(emitted));
            assert.strictEqual(last[0].passportId, 'only-matching');
            assert.strictEqual(last.length, 1);

            await col.database.close();
        });
    });
    describe('/get', () => {
        it('should return the correct documents', async () => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
            const ids = docs.map(d => d.passportId);
            const port = await nextPort();
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
            const client = createRestClient('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const response = await client.get(ids);
            assert.strictEqual(response.documents.length, 5);

            const responseSub = await client.get([ids[0]]);
            assert.strictEqual(responseSub.documents.length, 1);

            await col.database.close();
        });
        it('should respect the auth header and queryModifier', async () => {
            const col = await humansCollection.create(5);
            await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));
            const docs = await col.find().exec();
            const ids = docs.map(d => d.passportId);

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
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);
            const response = await client.get(ids);
            assert.strictEqual(response.documents.length, 1);
            assert.strictEqual(response.documents[0].passportId, 'only-matching');

            await col.database.close();
        });
        it('should have access-control-allow-credentials set to true for /query/observe', async () => {
            const col = await humansCollection.create(5);
            await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));

            const port = await nextPort();
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler,
                port,
                cors: `http://localhost:${port}`
            });
            const endpoint = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col,
                queryModifier
            });
            await server.start();

            const url = `http://localhost:${port}/${endpoint.urlPath}/query/observe`;

            // Just like /query, we POST to /query/observe
            const fetchResult = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ selector: {} }),
            });

            assert.strictEqual(
                fetchResult.headers.get('access-control-allow-credentials'),
                'true',
                'Expected Access-Control-Allow-Credentials header to be true'
            );

            assert.strictEqual(
                fetchResult.headers.get('access-control-allow-origin'),
                `http://localhost:${port}`,
                'Expected Access-Control-Allow-Origin to match request origin'
            );

            await col.database.close();
        });
    });
    describe('/set', () => {
        it('should write the documents', async () => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
            const port = await nextPort();
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
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const setDoc = docs[0].toMutableJSON();
            setDoc.age = 100;

            const response = await client.set([setDoc]);
            const docAfter = await col.findOne(setDoc.passportId).exec(true);
            assert.strictEqual(docAfter.age, 100);

            await col.database.close();
        });
        it('should not accept if changeValidator says no', async () => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
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
                changeValidator: () => false
            });
            await server.start();
            const client = createRestClient('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const ageBefore = docs[0].age;

            const setDoc = docs[0].toMutableJSON();
            setDoc.age = 100;

            const response = await client.set([setDoc]);

            // must still be the same because write must not be accepted
            const docAfter = await col.findOne(setDoc.passportId).exec(true);
            assert.strictEqual(docAfter.age, ageBefore);

            await col.database.close();

        });
    });
    describe('/delete', () => {
        it('should delete the documents', async () => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
            const ids = docs.map(d => d.passportId);
            const port = await nextPort();
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
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);


            await client.delete(ids);

            const docsAfter = await col.find().exec();
            assert.strictEqual(docsAfter.length, 0);

            await col.database.close();
        });
        it('should not accept if not matches queryModifier says no', async () => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
            const ids = docs.map(d => d.passportId);

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
            const client = createRestClient('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            await client.delete(ids);

            // must still be the same because write must not be accepted
            const docsAfter = await col.find().exec();
            assert.strictEqual(docsAfter.length, 5);

            // but the only matching doc should be allowed to be deleted
            const matchingDoc = await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));
            await client.delete([matchingDoc.primary]);
            const docsAfter2 = await col.find().exec();
            assert.strictEqual(docsAfter2.length, 5);

            await col.database.close();

        });
        it('should not accept if changeValidator says no', async () => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
            const ids = docs.map(d => d.passportId);
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
                changeValidator: () => false
            });
            await server.start();

            const client = createRestClient('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            await client.delete(ids);

            // must still be the same because write must not be accepted
            const docsAfter = await col.find().exec();
            assert.strictEqual(docsAfter.length, 5);

            await col.database.close();
        });
    });
    describe('.serverOnlyFields', () => {
        it('should not return serverOnlyFields to /query requests', async () => {
            const col = await humansCollection.create(3);
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
            const client = createRestClient('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const response = await client.query({});

            response.documents.forEach((doc: any) => {
                assert.strictEqual(typeof doc.lastName, 'undefined');

                // these fields must also not be set
                assert.strictEqual(typeof doc._rev, 'undefined');
                assert.strictEqual(typeof doc._meta, 'undefined');
            });

            await col.database.close();
        });
        it('should not emit serverOnlyFields to /get', async () => {
            const col = await humansCollection.create(3);
            const docs = await col.find().exec();
            const ids = docs.map(d => d.passportId);
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
            const client = createRestClient('http://localhost:' + port + '/' + endpoint.urlPath, headers);
            const response = await client.get(ids);
            response.documents.forEach((doc: any) => {
                assert.strictEqual(typeof doc.lastName, 'undefined');

                // these fields must also not be set
                assert.strictEqual(typeof doc._rev, 'undefined');
                assert.strictEqual(typeof doc._meta, 'undefined');
            });
            await col.database.close();
        });
        it('should keep the serverOnlyFields value on writes', async () => {
            const col = await humansCollection.create(1);
            const doc = await col.findOne().exec(true);
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
            const lastNameBefore = doc.lastName;

            let docFromServer = ensureNotFalsy(await client.get([doc.primary])).documents[0];
            docFromServer.firstName = 'foobar';

            await client.set([docFromServer]);
            const docAfter = await col.findOne().exec(true);
            assert.strictEqual(lastNameBefore, docAfter.lastName);
            assert.strictEqual(docAfter.firstName, 'foobar');
            await col.database.close();
        });
    });
});
