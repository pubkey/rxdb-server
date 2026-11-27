import assert from 'assert';

import {
    clone,
    ensureNotFalsy,
    lastOfArray,
    MangoQuery,
    randomToken
} from 'rxdb/plugins/core';
import {
    createRxServer,
    REST_PATHS
} from '../../plugins/server';
import {
    createRestClient
} from '../../plugins/client-rest';
import {
    schemaObjects,
    schemas,
    humansCollection,
    HumanDocumentType,
    humanDefault,
    randomStringWithSpecialChars
} from 'rxdb/plugins/test-utils';
import { nextPort, customFetchWithFixedHeaders } from './test-helpers.ts';
import { assertThrows, wait, waitUntil } from 'async-test-util';

import config from './config.ts';
import {
    authHandler,
    headers,
    queryModifier
} from './test-helpers.ts';
import { EventSource } from 'eventsource';
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
        it('should not allow a query when validUntil of the auth data has expired', async () => {
            const col = await humansCollection.create(1);
            const port = await nextPort();
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler: (requestHeaders) => {
                    const authData = authHandler(requestHeaders) as any;
                    return {
                        data: authData.data,
                        validUntil: Date.now() - 1000
                    };
                },
                port
            });
            const endpoint = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col
            });
            await server.start();
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);
            await assertThrows(
                () => client.query({ selector: {} }),
                Error,
                'Unauthorized'
            );
            await col.database.close();
        });
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
        it('should emit the newest result last when the authHandler has a varying latency', async () => {
            const col = await humansCollection.create(0);
            const port = await nextPort();
            let streamAuthCalls = 0;
            let slowAuthDone = false;
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler: async (requestHeaders) => {
                    if (requestHeaders.accept === 'text/event-stream') {
                        streamAuthCalls++;
                        if (streamAuthCalls === 3) {
                            await wait(300);
                            slowAuthDone = true;
                        }
                    }
                    return authHandler(requestHeaders);
                },
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

            const doc = await col.insert(schemaObjects.humanData('order-doc', 1, 'v1'));
            await doc.incrementalPatch({ firstName: 'v2' });

            await waitUntil(() => slowAuthDone && emitted.length === 3);
            await wait(100);

            const last = ensureNotFalsy(lastOfArray(emitted));
            assert.deepStrictEqual(last.map(d => d.firstName), ['v2']);

            await col.database.close();
        });
        it('should disconnect an open stream when the auth becomes invalid', async function () {
            this.timeout(10 * 1000);
            const col = await humansCollection.create(1);
            const port = await nextPort();
            let isValid = true;
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler: (requestHeaders) => {
                    if (!isValid) {
                        throw new Error('auth expired');
                    }
                    return authHandler(requestHeaders);
                },
                port
            });
            const endpoint = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col
            });
            await server.start();

            const query = encodeURIComponent(btoa(JSON.stringify({ selector: {} })));
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath + '/query/observe?query=' + query;
            const eventSource = new EventSource(url, { fetch: customFetchWithFixedHeaders(headers) });
            let emitted = 0;
            eventSource.onmessage = () => emitted++;
            const errorCodes: (number | undefined)[] = [];
            eventSource.onerror = (err) => errorCodes.push(err.code);
            await waitUntil(() => emitted === 1);

            isValid = false;
            await col.insert(schemaObjects.humanData());

            // the stream ends, so the client starts to reconnect
            await waitUntil(() => errorCodes.length > 0);
            assert.strictEqual(eventSource.readyState, eventSource.CONNECTING);

            // the reconnect is answered with a 401
            await waitUntil(() => errorCodes.includes(401), 8000);
            assert.strictEqual(eventSource.readyState, eventSource.CLOSED);
            assert.strictEqual(emitted, 1);

            eventSource.close();
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
        it('should not allow $regex queries', async () => {
            /**
             * Reproduces a queryModifier bug:
             * The /query endpoint correctly rejects $regex queries with
             * 400 Bad Request (DOS-attack protection wraps the queryModifier
             * with a check that throws on $regex). The /query/observe handler
             * runs the same wrapped queryModifier but calls it AFTER
             * setSSEHeaders has already committed a 200 OK SSE response,
             * and the call is not wrapped in try/catch. A client that sends
             * a $regex query therefore sees a successful 200 status and an
             * empty stream that the server then drops, instead of the same
             * 400 Bad Request that /query returns.
             */
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
                collection: col,
                queryModifier
            });
            await server.start();

            const queryAsBase64 = btoa(JSON.stringify({
                selector: {
                    firstName: {
                        $regex: 'foobar'
                    }
                }
            } satisfies MangoQuery<HumanDocumentType>));
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath + '/query/observe?query=' + queryAsBase64;
            const response = await fetch(url, { headers });

            assert.strictEqual(
                response.status,
                400,
                '/query/observe must reject $regex queries with 400 Bad Request, just like /query'
            );

            await col.database.close();
        });
        it('should work when the base64-encoded query contains URL-reserved characters', async () => {
            /**
             * The client serializes the query as base64 and embeds it into the
             * /query/observe URL as a query parameter. Standard base64 uses
             * '+' and '/' which are URL-reserved: in a URL query string, '+'
             * is decoded as a space, so the server receives a corrupted base64
             * string and atob() throws "Invalid character". The SSE handler
             * crashes after the response headers are already written, so the
             * client never receives any document and just hangs.
             *
             * The firstName chosen here is unicode whose JSON-stringified
             * UTF-8 bytes encode to a base64 string that contains '+'.
             */
            const targetFirstName = 'ûÿþ';
            const queryB64 = btoa(JSON.stringify({
                selector: { firstName: { $eq: targetFirstName } }
            }));
            assert.ok(
                queryB64.includes('+') || queryB64.includes('/'),
                'pre-condition for this test: the base64 of the query must contain a URL-reserved character'
            );

            const col = await humansCollection.create(0);
            await col.insert(schemaObjects.humanData('match-doc', 1, targetFirstName));
            await col.insert(schemaObjects.humanData('other-doc', 2, 'normal'));
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
            const subscription = client.observeQuery({
                selector: { firstName: { $eq: targetFirstName } }
            }).subscribe(result => emitted.push(result));

            await waitUntil(() => emitted.length === 1, 3000);

            const last = ensureNotFalsy(lastOfArray(emitted));
            assert.strictEqual(last.length, 1);
            assert.strictEqual(last[0].passportId, 'match-doc');

            subscription.unsubscribe();
            await col.database.close();
        });
        it('should observe queries that contain characters outside of Latin-1', async () => {
            const names = ['日本', 'a😀', 'Привет'];
            const col = await humansCollection.create(0);
            await Promise.all(names.map((name, i) => col.insert(schemaObjects.humanData('doc' + i, i + 1, name))));
            await col.insert(schemaObjects.humanData('other-doc', 10, 'normal'));
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

            for (const [i, name] of names.entries()) {
                const emitted: HumanDocumentType[][] = [];
                const subscription = client.observeQuery({
                    selector: { firstName: { $eq: name } }
                }).subscribe(result => emitted.push(result));
                await waitUntil(() => emitted.length === 1, 3000);
                const last = ensureNotFalsy(lastOfArray(emitted));
                assert.deepStrictEqual(last.map(d => d.passportId), ['doc' + i]);
                subscription.unsubscribe();
            }

            await col.database.close();
        });
        it('should keep the Latin-1 query encoding of older clients', async () => {
            const col = await humansCollection.create(0);
            await col.insert(schemaObjects.humanData('match-doc', 1, 'Müller'));
            await col.insert(schemaObjects.humanData('other-doc', 2, 'normal'));
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

            const queryAsBase64 = encodeURIComponent(btoa(JSON.stringify({
                selector: { firstName: { $eq: 'Müller' } }
            })));
            const emitted: HumanDocumentType[][] = [];
            const eventSource = new EventSource(
                'http://localhost:' + port + '/' + endpoint.urlPath + '/query/observe?query=' + queryAsBase64,
                { fetch: customFetchWithFixedHeaders(headers) }
            );
            eventSource.onmessage = event => emitted.push(JSON.parse(event.data));
            await waitUntil(() => emitted.length === 1, 3000);
            eventSource.close();
            assert.deepStrictEqual(emitted[0].map(d => d.passportId), ['match-doc']);

            const requestedUrls: string[] = [];
            class RecordingEventSource extends EventSource {
                constructor(url: string, init?: any) {
                    requestedUrls.push(url);
                    super(url, init);
                }
            }
            const client = createRestClient<HumanDocumentType>(
                'http://localhost:' + port + '/' + endpoint.urlPath,
                headers,
                RecordingEventSource
            );
            const clientEmitted: HumanDocumentType[][] = [];
            const subscription = client.observeQuery({
                selector: { firstName: { $eq: 'Müller' } }
            }).subscribe(result => clientEmitted.push(result));
            await waitUntil(() => clientEmitted.length === 1, 3000);
            subscription.unsubscribe();
            assert.deepStrictEqual(clientEmitted[0].map(d => d.passportId), ['match-doc']);
            assert.strictEqual(new URL(requestedUrls[0]).search, '?query=' + queryAsBase64);

            await col.database.close();
        });
        it('should stop observing on the server when the client unsubscribes', async () => {
            const col = await humansCollection.create(1);
            const port = await nextPort();
            let authCalls = 0;
            const server = await createRxServer({
                adapter: TEST_SERVER_ADAPTER,
                database: col.database,
                authHandler: (requestHeaders) => {
                    authCalls++;
                    return authHandler(requestHeaders);
                },
                port
            });
            const endpoint = await server.addRestEndpoint({
                name: randomToken(10),
                collection: col
            });
            await server.start();
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const emitted: HumanDocumentType[][] = [];
            const subscription = client.observeQuery({}).subscribe(result => emitted.push(result));
            await waitUntil(() => emitted.length === 1);
            subscription.unsubscribe();
            await wait(300);

            const authCallsAfterUnsubscribe = authCalls;
            await col.insert(schemaObjects.humanData('doc1', 1, headers.userid));
            await wait(300);
            assert.strictEqual(
                authCalls,
                authCallsAfterUnsubscribe,
                'the server must not run the observed query after the client unsubscribed'
            );

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

            await assertThrows(
                () => client.set([setDoc]),
                Error,
                'error'
            );

            // must still be the same because write must not be accepted
            const docAfter = await col.findOne(setDoc.passportId).exec(true);
            assert.strictEqual(docAfter.age, ageBefore);

            await col.database.close();

        });
        it('should not accept new document inserts if changeValidator says no', async () => {
            // Bug: the /set endpoint only ran the changeValidator for UPDATES
            // of existing documents, not for INSERTS of new documents. A
            // changeValidator that returns false therefore had no effect on
            // new-document writes, contradicting the documented contract that
            // the changeValidator decides whether a change is accepted.
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
                changeValidator: () => false
            });
            await server.start();
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const newDoc: HumanDocumentType = schemaObjects.humanData('new-doc-cv', 1, headers.userid);

            await assertThrows(
                () => client.set([newDoc]),
                Error,
                'error'
            );

            // The new document must NOT have been inserted because the
            // changeValidator rejected it.
            const docsAfter = await col.find().exec();
            assert.strictEqual(docsAfter.length, 0);

            await col.database.close();
        });
        it('should throw an error via handleError when the server rejects a set', async () => {
            const col = await humansCollection.create(1);
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
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const setDoc = docs[0].toMutableJSON();
            setDoc.age = 100;

            // When the server rejects the write, the client should throw an error
            await assertThrows(
                () => client.set([setDoc]),
                Error,
                'error'
            );

            await col.database.close();
        });
        it('should throw an error via handleError when the server rejects a delete', async () => {
            const col = await humansCollection.create(1);
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
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            // When the server rejects the delete, the client should throw an error
            await assertThrows(
                () => client.delete(ids),
                Error,
                'error'
            );

            await col.database.close();
        });
        it('should not allow overwriting a document the user does not own', async () => {
            const col = await humansCollection.create(0);

            // Insert a document owned by another user (bob).
            const bobDoc = await col.insert(schemaObjects.humanData('bob-doc', 30, 'bob'));
            const bobLastNameBefore = bobDoc.lastName;
            const bobAgeBefore = bobDoc.age;

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

            // Alice connects and tries to take over bob's document by sending a
            // write with bob's passportId but alice's firstName so it passes the
            // queryModifier check.
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const maliciousDoc: HumanDocumentType = {
                passportId: 'bob-doc',
                firstName: headers.userid,
                lastName: 'hacked',
                age: 99
            };

            let errorThrown = false;
            try {
                await client.set([maliciousDoc]);
            } catch (err) {
                errorThrown = true;
            }
            assert.ok(errorThrown, 'server must reject the overwrite attempt');

            // Bob's document must still be intact.
            const bobDocAfter = await col.findOne('bob-doc').exec(true);
            assert.strictEqual(bobDocAfter.firstName, 'bob');
            assert.strictEqual(bobDocAfter.lastName, bobLastNameBefore);
            assert.strictEqual(bobDocAfter.age, bobAgeBefore);

            await col.database.close();
        });
        it('should not allow reviving a deleted document the user does not own', async () => {
            const col = await humansCollection.create(0);
            const bobDoc = await col.insert(schemaObjects.humanData('bob-deleted-doc', 30, 'bob'));
            await bobDoc.remove();

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
                () => client.set([{
                    passportId: 'bob-deleted-doc',
                    firstName: headers.userid,
                    lastName: 'hacked',
                    age: 99
                }]),
                Error,
                'error'
            );
            await wait(100);

            const docAfter = await col.findOne('bob-deleted-doc').exec();
            assert.strictEqual(docAfter, null);

            await col.database.close();
        });
        it('should allow reviving an own deleted document', async () => {
            const col = await humansCollection.create(0);
            const ownDoc = await col.insert(schemaObjects.humanData('own-deleted-doc', 30, headers.userid));
            await ownDoc.remove();

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

            await client.set([{
                passportId: 'own-deleted-doc',
                firstName: headers.userid,
                lastName: 'revived',
                age: 99
            }]);

            const docAfter = await col.findOne('own-deleted-doc').exec(true);
            assert.strictEqual(docAfter.lastName, 'revived');

            await col.database.close();
        });
        it('should not write any document when one document of the request is not allowed', async () => {
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
                changeValidator: (_authData, change) => change.newDocumentState.lastName !== 'forbidden'
            });
            await server.start();
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            const allowedDoc = schemaObjects.humanData('allowed-doc', 1, headers.userid);
            const forbiddenDoc = schemaObjects.humanData('forbidden-doc', 1, headers.userid);
            forbiddenDoc.lastName = 'forbidden';

            await assertThrows(
                () => client.set([allowedDoc, forbiddenDoc]),
                Error,
                'error'
            );
            await wait(100);

            const docsAfter = await col.find().exec();
            assert.deepStrictEqual(docsAfter.map(d => d.passportId), []);

            await col.database.close();
        });
    });
    describe('/patch', () => {
        async function startPatchServer(col: any, withQueryModifier = false) {
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
                queryModifier: withQueryModifier ? queryModifier : undefined
            });
            await server.start();
            return createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);
        }
        it('should update the given fields and keep the others', async () => {
            const col = await humansCollection.create(0);
            const docBefore = await col.insert(schemaObjects.humanData('patch-doc', 30, headers.userid));
            const client = await startPatchServer(col);

            await client.patch([{ passportId: 'patch-doc', age: 31 }]);

            const docAfter = await col.findOne('patch-doc').exec(true);
            assert.strictEqual(docAfter.age, 31);
            assert.strictEqual(docAfter.firstName, docBefore.firstName);
            assert.strictEqual(docAfter.lastName, docBefore.lastName);

            await col.database.close();
        });
        it('should insert new documents', async () => {
            const col = await humansCollection.create(0);
            const client = await startPatchServer(col);

            const newDoc = schemaObjects.humanData('patch-new-doc', 20, headers.userid);
            await client.patch([newDoc]);

            const docAfter = await col.findOne('patch-new-doc').exec(true);
            assert.deepStrictEqual(docAfter.toJSON(), newDoc);

            await col.database.close();
        });
        it('should not allow patching a document the user does not own', async () => {
            const col = await humansCollection.create(0);
            await col.insert(schemaObjects.humanData('bob-patch-doc', 30, 'bob'));
            const client = await startPatchServer(col, true);

            const response = await fetch(client.endpointUrl + '/patch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: JSON.stringify([{
                    passportId: 'bob-patch-doc',
                    firstName: headers.userid,
                    lastName: 'hacked'
                }])
            });
            assert.strictEqual(response.status, 403);

            const docAfter = await col.findOne('bob-patch-doc').exec(true);
            assert.strictEqual(docAfter.firstName, 'bob');
            assert.notStrictEqual(docAfter.lastName, 'hacked');

            await col.database.close();
        });
        it('should give a 426 error on outdated versions', async () => {
            const newestSchema = clone(schemas.human);
            newestSchema.version = 1;
            const col = await humansCollection.createBySchema(newestSchema, undefined, undefined, { 1: (d: any) => d });
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

            for (const path of ['', ...REST_PATHS]) {
                const response = await fetch('http://localhost:' + port + '/' + endpoint.name + '/0/' + path);
                assert.strictEqual(response.status, 426, path);
            }

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

            await assertThrows(
                () => client.delete(ids),
                Error,
                'error'
            );

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

            await assertThrows(
                () => client.delete(ids),
                Error,
                'error'
            );

            // must still be the same because write must not be accepted
            const docsAfter = await col.find().exec();
            assert.strictEqual(docsAfter.length, 5);

            await col.database.close();
        });
        it('should not delete if the changeValidator does not allow deletions', async () => {
            const col = await humansCollection.create(0);
            const doc = await col.insert(schemaObjects.humanData('no-delete-doc'));
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
                changeValidator: (_authData, change) => !change.newDocumentState._deleted
            });
            await server.start();
            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);

            await assertThrows(
                () => client.delete([doc.primary]),
                Error,
                'error'
            );

            const docAfter = await col.findOne(doc.primary).exec();
            assert.ok(docAfter);

            await col.database.close();
        });
        it('should not delete any document when one document of the request is not allowed', async () => {
            const col = await humansCollection.create(0);
            const ownDoc = await col.insert(schemaObjects.humanData('own-doc', 1, headers.userid));
            const foreignDoc = await col.insert(schemaObjects.humanData('foreign-doc', 1, 'bob'));
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
                () => client.delete([ownDoc.primary, foreignDoc.primary]),
                Error,
                'error'
            );
            await wait(100);

            const docsAfter = await col.find().exec();
            assert.deepStrictEqual(docsAfter.map(d => d.passportId).sort(), ['foreign-doc', 'own-doc']);

            await col.database.close();
        });
    });
    describe('special characters', () => {
        /**
         * Contains characters that are relevant for URL parsing and
         * base64 encoding, characters outside of Latin-1 and the random
         * emojis and special chars of the RxDB test data.
         */
        function specialString() {
            return '%&#+?=/ \\😊🏳️‍🌈äß' + randomStringWithSpecialChars(8, 12);
        }
        async function startServer(col: Awaited<ReturnType<typeof humansCollection.create>>) {
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
            return createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);
        }
        it('should set, get, query, patch and delete documents with special characters', async () => {
            const col = await humansCollection.create(0);
            const client = await startServer(col);

            const docs = new Array(5).fill(0).map(() => schemaObjects.humanData(
                specialString(),
                20,
                specialString()
            ));
            const ids = docs.map(d => d.passportId);
            await client.set(docs);

            const storedDocs = await col.find().exec();
            assert.deepStrictEqual(
                storedDocs.map(d => d.passportId).sort(),
                ids.slice(0).sort()
            );

            const getResult = await client.get(ids);
            assert.deepStrictEqual(
                getResult.documents.map((d: HumanDocumentType) => d.passportId).sort(),
                ids.slice(0).sort()
            );

            for (const doc of docs) {
                const byId = await client.query({ selector: { passportId: doc.passportId } });
                assert.deepStrictEqual(byId.documents.map((d: HumanDocumentType) => d.passportId), [doc.passportId]);
                const byName = await client.query({ selector: { firstName: { $eq: doc.firstName } } });
                assert.deepStrictEqual(byName.documents.map((d: HumanDocumentType) => d.passportId), [doc.passportId]);
            }

            const newLastName = specialString();
            await client.patch([{ passportId: ids[0], lastName: newLastName }]);
            const patched = await col.findOne(ids[0]).exec(true);
            assert.strictEqual(patched.lastName, newLastName);
            assert.strictEqual(patched.firstName, docs[0].firstName);

            await client.delete(ids);
            const docsAfter = await col.find().exec();
            assert.strictEqual(docsAfter.length, 0);

            await col.database.close();
        });
        it('should observe a query that filters by a value with special characters', async () => {
            const col = await humansCollection.create(2);
            const client = await startServer(col);

            const firstName = specialString();
            const emitted: HumanDocumentType[][] = [];
            const sub = client.observeQuery({ selector: { firstName: { $eq: firstName } } }).subscribe(result => emitted.push(result));
            await waitUntil(() => emitted.length === 1);
            assert.strictEqual(ensureNotFalsy(emitted[0]).length, 0);

            const passportId = specialString();
            await col.insert(schemaObjects.humanData(passportId, 20, firstName));
            await waitUntil(() => emitted.length === 2);
            assert.deepStrictEqual(
                ensureNotFalsy(lastOfArray(emitted)).map(d => d.passportId),
                [passportId]
            );

            sub.unsubscribe();
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
        it('should allow deleting documents when serverOnlyFields is set', async () => {
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

            // deleting a document should work even when serverOnlyFields is configured
            const docsBefore = await col.find().exec();
            assert.strictEqual(docsBefore.length, 1);

            await client.delete([doc.primary]);

            const docsAfter = await col.find().exec();
            assert.strictEqual(docsAfter.length, 0);

            await col.database.close();
        });
        it('should not allow clients to set serverOnlyFields when inserting NEW documents via /set', async () => {
            // Use humanDefault schema where lastName is optional so the insert
            // with lastName stripped is still schema-valid.
            const col = await humansCollection.createBySchema(humanDefault);
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

            // The client crafts a NEW document with the server-only field set.
            const newDoc: HumanDocumentType = schemaObjects.humanData('new-doc-restset', 1);
            newDoc.lastName = 'HackedValue';

            await client.set([newDoc]);

            // The server-only field must NOT have been written with the
            // client-provided value when the document is created.
            const docAfter = await col.findOne('new-doc-restset').exec(true);
            assert.strictEqual(docAfter.firstName, newDoc.firstName);
            assert.notStrictEqual(
                docAfter.lastName,
                'HackedValue',
                'Client must not be able to set a server-only field on document creation via /set'
            );

            await col.database.close();
        });
        it('should allow /set updates when the queryModifier uses a serverOnlyField', async () => {
            const col = await humansCollection.create(0);
            await col.insert({ ...schemaObjects.humanData('owned'), age: 42 });
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
                queryModifier: (_authData, query) => {
                    query.selector.age = { $eq: 42 };
                    return query;
                },
                serverOnlyFields: ['age']
            });
            await server.start();

            const client = createRestClient<HumanDocumentType>('http://localhost:' + port + '/' + endpoint.urlPath, headers);
            const docFromServer = ensureNotFalsy(await client.get(['owned'])).documents[0];
            assert.strictEqual(typeof docFromServer.age, 'undefined');

            docFromServer.firstName = 'changed';
            await client.set([docFromServer]);

            const docAfter = await col.findOne('owned').exec(true);
            assert.strictEqual(docAfter.firstName, 'changed');
            assert.strictEqual(docAfter.age, 42);
            await col.database.close();
        });
        it('should not allow clients to overwrite serverOnlyFields via /set', async () => {
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

            // Get document from server (lastName is stripped as a server-only field)
            let docFromServer = ensureNotFalsy(await client.get([doc.primary])).documents[0];

            // Client attempts to set the server-only field along with a regular update
            docFromServer.lastName = 'HackedValue';
            docFromServer.firstName = 'UpdatedName';

            await client.set([docFromServer]);

            // The server-only field must be preserved with its original value,
            // not overwritten by the client's value
            const docAfter = await col.findOne().exec(true);
            assert.strictEqual(docAfter.firstName, 'UpdatedName');
            assert.strictEqual(docAfter.lastName, lastNameBefore);
            await col.database.close();
        });
    });
});
