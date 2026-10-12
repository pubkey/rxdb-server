import type { RxCollection, RxDatabase } from 'rxdb/plugins/core';
import { RxServerReplicationEndpoint } from './endpoint-replication.ts';
import type { RxServerAdapter, RxServerAuthHandler, RxServerChangeValidator, RxServerEndpoint, RxServerOptions, RxServerQueryModifier } from './types.ts';
import { RxServerRestEndpoint } from './endpoint-rest.ts';
export declare class RxServer<ServerAppType, AuthType> {
    readonly options: RxServerOptions<ServerAppType, AuthType>;
    readonly authHandler: RxServerAuthHandler<AuthType>;
    readonly serverApp: ServerAppType;
    readonly cors: string;
    readonly endpoints: RxServerEndpoint<AuthType, any>[];
    private closeFn;
    listenPromise?: Promise<void>;
    readonly database: RxDatabase;
    readonly adapter: RxServerAdapter<ServerAppType>;
    constructor(options: RxServerOptions<ServerAppType, AuthType>, authHandler: RxServerAuthHandler<AuthType>, serverApp: ServerAppType, cors?: string);
    private ensureNotStarted;
    addReplicationEndpoint<RxDocType>(opts: {
        name: string;
        collection: RxCollection<RxDocType>;
        queryModifier?: RxServerQueryModifier<AuthType, RxDocType>;
        changeValidator?: RxServerChangeValidator<AuthType, RxDocType>;
        /**
         * Set a origin for allowed CORS requests.
         * Overwrites the cors option of the server.
         * [default='*']
         */
        cors?: '*' | string;
        serverOnlyFields?: string[];
    }): RxServerReplicationEndpoint<ServerAppType, AuthType, RxDocType>;
    addRestEndpoint<RxDocType>(opts: {
        name: string;
        collection: RxCollection<RxDocType>;
        queryModifier?: RxServerQueryModifier<AuthType, RxDocType>;
        changeValidator?: RxServerChangeValidator<AuthType, RxDocType>;
        /**
         * Set a origin for allowed CORS requests.
         * Overwrites the cors option of the server.
         * [default='*']
         */
        cors?: '*' | string;
        serverOnlyFields?: string[];
    }): RxServerRestEndpoint<ServerAppType, AuthType, RxDocType>;
    start(): Promise<void>;
    close(): Promise<void>;
}
