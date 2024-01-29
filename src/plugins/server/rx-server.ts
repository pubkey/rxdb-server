import type {
    RxCollection,
    RxDatabase
} from 'rxdb/plugins/core';
import { RxServerReplicationEndpoint } from './endpoint-replication.ts';
import type {
    RxServerAuthHandler,
    RxServerChangeValidator,
    RxServerEndpoint,
    RxServerQueryModifier
} from './types.ts';
import {
    Server as HttpServer
} from 'http';
import { Express } from 'express';
import { RxServerRestEndpoint } from './endpoint-rest.ts';

export class RxServer<AuthType> {
    public readonly endpoints: RxServerEndpoint<AuthType, any>[] = [];

    private closeFn = (() => this.close()).bind(this);

    constructor(
        public readonly database: RxDatabase,
        public readonly authHandler: RxServerAuthHandler<AuthType>,
        public readonly httpServer: HttpServer,
        public readonly expressApp: Express,
        public readonly cors: string = '*'
    ) {
        database.onDestroy.push(this.closeFn);
    }

    public async addReplicationEndpoint<RxDocType>(opts: {
        collection: RxCollection<RxDocType>,
        queryModifier?: RxServerQueryModifier<AuthType, RxDocType>,
        changeValidator?: RxServerChangeValidator<AuthType, RxDocType>,
        /**
         * Set a origin for allowed CORS requests.
         * Overwrites the cors option of the server.
         * [default='*']
         */
        cors?: '*' | string,
        serverOnlyFields?: string[]
    }) {
        const endpoint = new RxServerReplicationEndpoint(
            this,
            opts.collection,
            opts.queryModifier ? opts.queryModifier : (_a, q) => q,
            opts.changeValidator ? opts.changeValidator : () => true,
            opts.serverOnlyFields ? opts.serverOnlyFields : [],
            opts.cors
        );
        this.endpoints.push(endpoint);
        return endpoint;
    }

    public async addRestEndpoint<RxDocType>(opts: {
        collection: RxCollection<RxDocType>,
        queryModifier?: RxServerQueryModifier<AuthType, RxDocType>,
        changeValidator?: RxServerChangeValidator<AuthType, RxDocType>,
        /**
         * Set a origin for allowed CORS requests.
         * Overwrites the cors option of the server.
         * [default='*']
         */
        cors?: '*' | string,
        serverOnlyFields?: string[]
    }) {
        const endpoint = new RxServerRestEndpoint(
            this,
            opts.collection,
            opts.queryModifier ? opts.queryModifier : (_a, q) => q,
            opts.changeValidator ? opts.changeValidator : () => true,
            opts.serverOnlyFields ? opts.serverOnlyFields : [],
            opts.cors
        );
        this.endpoints.push(endpoint);
        return endpoint;
    }

    async close() {
        this.database.onDestroy = this.database.onDestroy.filter(fn => fn !== this.closeFn);
        await new Promise<void>((res, rej) => {
            this.httpServer.close((err) => {
                if (err) { rej(err); } else { res(); }
            });
            /**
             * By default it will await all ongoing connections
             * before it closes. So we have to close it directly.
             * @link https://stackoverflow.com/a/36830072/3443137
             */
            setImmediate(() => this.httpServer.emit('close'));
        });

    }
}
