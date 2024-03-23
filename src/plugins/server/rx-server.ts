import type {
    RxCollection,
    RxDatabase
} from 'rxdb/plugins/core';
import { RxServerReplicationEndpoint } from './endpoint-replication.ts';
import type {
    RxServerAdapter,
    RxServerAuthHandler,
    RxServerChangeValidator,
    RxServerEndpoint,
    RxServerOptions,
    RxServerQueryModifier
} from './types.ts';
import { RxServerRestEndpoint } from './endpoint-rest.ts';

export class RxServer<ServerAppType, AuthType> {
    public readonly endpoints: RxServerEndpoint<AuthType, any>[] = [];

    private closeFn = (() => this.close()).bind(this);
    public listenPromise?: Promise<void>;

    public readonly database: RxDatabase;
    public readonly adapter: RxServerAdapter<ServerAppType>;

    constructor(
        public readonly options: RxServerOptions<ServerAppType, AuthType>,
        public readonly authHandler: RxServerAuthHandler<AuthType>,
        public readonly serverApp: ServerAppType,
        public readonly cors: string = '*'
    ) {
        this.database = options.database;
        this.adapter = options.adapter;
        options.database.onDestroy.push(this.closeFn);
    }

    private ensureNotStarted() {
        if (this.listenPromise) {
            throw new Error('This operation cannot be run after the RxServer has been started already');
        }

    }

    public addReplicationEndpoint<RxDocType>(opts: {
        name: string,
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
        this.ensureNotStarted();
        const endpoint = new RxServerReplicationEndpoint(
            this,
            opts.name,
            opts.collection,
            opts.queryModifier ? opts.queryModifier : (_a, q) => q,
            opts.changeValidator ? opts.changeValidator : () => true,
            opts.serverOnlyFields ? opts.serverOnlyFields : [],
            opts.cors
        );
        this.endpoints.push(endpoint);
        return endpoint;
    }

    public addRestEndpoint<RxDocType>(opts: {
        name: string,
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
        this.ensureNotStarted();
        const endpoint = new RxServerRestEndpoint(
            this,
            opts.name,
            opts.collection,
            opts.queryModifier ? opts.queryModifier : (_a, q) => q,
            opts.changeValidator ? opts.changeValidator : () => true,
            opts.serverOnlyFields ? opts.serverOnlyFields : [],
            opts.cors
        );
        this.endpoints.push(endpoint);
        return endpoint;
    }

    async start() {
        this.ensureNotStarted();
        const hostname = this.options.hostname ? this.options.hostname : 'localhost';
        this.listenPromise = this.options.adapter.listen(this.serverApp, this.options.port, hostname);
        return this.listenPromise;
    }

    async close() {
        this.database.onDestroy = this.database.onDestroy.filter(fn => fn !== this.closeFn);
        if (this.listenPromise) {
            await this.listenPromise;
            await this.options.adapter.close(this.serverApp);
        }
    }
}
