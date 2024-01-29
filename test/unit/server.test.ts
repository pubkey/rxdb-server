import assert from 'assert';

import {
    addRxPlugin,
    overwritable
} from 'rxdb/plugins/core';
import {
    startRxServer,
    doesContainRegexQuerySelector
} from '../../plugins/server';
import {
    nextPort,
    humansCollection
} from 'rxdb/plugins/test-utils';
import { RxDBMigrationPlugin } from 'rxdb/plugins/migration-schema';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';

import config from './config.ts';
import { authHandler } from './test-helpers.ts';

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
            const server = await startRxServer({
                database: col.database,
                authHandler,
                port
            });
            assert.ok(server);
            await col.database.destroy();
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
});
