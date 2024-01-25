import assert from 'assert';

import {
    addRxPlugin
} from 'rxdb/plugins/core';
import {
    startRxServer
} from '../../plugins/server';
import {
    nextPort,
    humansCollection
} from 'rxdb/plugins/test-utils';
import { RxDBMigrationPlugin } from 'rxdb/plugins/migration-schema';

addRxPlugin(RxDBMigrationPlugin);

import config from './config.ts';
import { authHandler } from './test-helpers.ts';

describe('server.test.ts', () => {
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
            assert.ok(server);
            await col.database.destroy();
        });
    });
});
