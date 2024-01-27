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
import { AuthType, authHandler, headers, urlSubPaths } from './test-helpers.ts';


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
            await server.addReplicationEndpoint({
                collection: col
            });
            await col.database.destroy();
        });
    });
});
