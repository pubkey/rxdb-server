import assert from 'assert';

import {
    addRxPlugin,
    clone,
    randomCouchString
} from 'rxdb/plugins/core';
import {
    type RxServerChangeValidator,
    type RxServerQueryModifier,
    startRxServer
} from '../../plugins/server';
import {
    replicateServer
} from '../../plugins/replication-server';
import {
    schemaObjects,
    schemas,
    nextPort,
    humansCollection,
    ensureReplicationHasNoErrors,
    isFastMode,
    HumanDocumentType
} from 'rxdb/plugins/test-utils';
import { wait, waitUntil } from 'async-test-util';
import EventSource from 'eventsource';

import config from './config.ts';
import { AuthType, authHandler, headers, postRequest, queryModifier, urlSubPaths } from './test-helpers.ts';


describe('endpoint-rest.test.ts', () => {
    assert.ok(config);
    describe('basics', () => {
        it('should start end stop the server', async () => {
            const port = await nextPort();
            const col = await humansCollection.create(0);
            const server = await startRxServer({
                database: col.database,
                authHandler,
                port
            });
            await server.addRestEndpoint({
                collection: col
            });
            await col.database.destroy();
        });
    });
    describe('/query', () => {
        it('should return the correct query results', async () => {
            const col = await humansCollection.create(5);
            const port = await nextPort();
            const server = await startRxServer({
                database: col.database,
                authHandler,
                port
            });
            const endpoint = await server.addRestEndpoint({
                collection: col
            });
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath + '/query';

            const response = await postRequest(url, { selector: {} });
            assert.strictEqual(response.documents.length, 5);

            const responseSub = await postRequest(url, {
                selector: {
                    passportId: { $eq: response.documents[0].passportId }
                }
            });
            assert.strictEqual(responseSub.documents.length, 1);

            await col.database.destroy();
        });
        it('should respect the auth header and queryModifier', async () => {
            const col = await humansCollection.create(5);
            await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));
            const port = await nextPort();
            const server = await startRxServer({
                database: col.database,
                authHandler,
                port
            });
            const endpoint = await server.addRestEndpoint({
                collection: col,
                queryModifier
            });
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath + '/query';
            const response = await postRequest(url, { selector: {} });
            assert.strictEqual(response.documents.length, 1);
            assert.strictEqual(response.documents[0].passportId, 'only-matching');

            await col.database.destroy();
        });
    });
    describe('/get', () => {
        it('should return the correct documents', async () => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
            const ids = docs.map(d => d.passportId);
            const port = await nextPort();
            const server = await startRxServer({
                database: col.database,
                authHandler,
                port
            });
            const endpoint = await server.addRestEndpoint({
                collection: col
            });
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath + '/get';

            const response = await postRequest(url, ids);
            assert.strictEqual(response.documents.length, 5);

            const responseSub = await postRequest(url, [ids[0]]);
            assert.strictEqual(responseSub.documents.length, 1);

            await col.database.destroy();
        });
        it('should respect the auth header and queryModifier', async () => {
            const col = await humansCollection.create(5);
            await col.insert(schemaObjects.humanData('only-matching', 1, headers.userid));
            const docs = await col.find().exec();
            const ids = docs.map(d => d.passportId);

            const port = await nextPort();
            const server = await startRxServer({
                database: col.database,
                authHandler,
                port
            });
            const endpoint = await server.addRestEndpoint({
                collection: col,
                queryModifier
            });
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath + '/get';
            const response = await postRequest(url, ids);
            assert.strictEqual(response.documents.length, 1);
            assert.strictEqual(response.documents[0].passportId, 'only-matching');

            await col.database.destroy();
        });
    });
    describe('/set', () => {
        it('should write the documents', async () => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
            const port = await nextPort();
            const server = await startRxServer({
                database: col.database,
                authHandler,
                port
            });
            const endpoint = await server.addRestEndpoint({
                collection: col
            });
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath + '/set';

            const setDoc = docs[0].toMutableJSON();
            setDoc.age = 100;

            const response = await postRequest(url, [setDoc]);

            const docAfter = await col.findOne(setDoc.passportId).exec(true);
            assert.strictEqual(docAfter.age, 100);

            await col.database.destroy();
        });
        it('should not accept if changeValidator says no', async() => {
            const col = await humansCollection.create(5);
            const docs = await col.find().exec();
            const port = await nextPort();
            const server = await startRxServer({
                database: col.database,
                authHandler,
                port
            });
            const endpoint = await server.addRestEndpoint({
                collection: col,
                changeValidator: () => false
            });
            const url = 'http://localhost:' + port + '/' + endpoint.urlPath + '/set';

            const setDoc = docs[0].toMutableJSON();
            setDoc.age = 100;

            const response = await postRequest(url, [setDoc]);

            const docAfter = await col.findOne(setDoc.passportId).exec(true);
            assert.strictEqual(docAfter.age, 100);

            await col.database.destroy();

        });
    });
});
