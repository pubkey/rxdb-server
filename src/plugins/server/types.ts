import type {
    FilledMangoQuery,
    RxDatabase,
    RxReplicationWriteToMasterRow,
    MaybePromise,
    RxCollection
} from 'rxdb/plugins/core';
import { IncomingHttpHeaders } from 'http';

export type RxServerOptions<ServerAppType, AuthType> = {
    database: RxDatabase;
    adapter: RxServerAdapter<ServerAppType, any, any>;
    serverApp?: ServerAppType;
    authHandler?: RxServerAuthHandler<AuthType>;
    appOptions?: any;
    /**
     * [default=localhost]
     */
    hostname?: 'localhost' | '0.0.0.0' | string;
    port: number;
    /**
     * Set a origin for allowed CORS requests.
     * Can be overwritten by the cors option of the endpoints.
     * [default='*']
     */
    cors?: '*' | string;
};


export type RxServerRouteHandler<RequestType = any, ResponseType = any> = (req: RequestType, res: ResponseType, next?: any) => MaybePromise<void>;

export type RxServerAdapter<ServerAppType, RequestType = any, ResponseType = any> = {
    create(): Promise<ServerAppType>;

    get(app: ServerAppType, path: string, handler: RxServerRouteHandler<RequestType, ResponseType>): void;
    post(app: ServerAppType, path: string, handler: RxServerRouteHandler<RequestType, ResponseType>): void;
    all(app: ServerAppType, path: string, handler: RxServerRouteHandler<RequestType, ResponseType>): void;

    setCors(app: ServerAppType, path: string, cors: string): void;

    getRequestBody(req: RequestType): any;
    getRequestHeaders(req: RequestType): { [k: string]: string };
    getRequestQuery(req: RequestType): any;
    onRequestClose(req: RequestType, handler: () => void): void;

    setResponseHeader(res: ResponseType, name: string, value: string): void;
    endResponseJson(res: ResponseType, data: any): void;
    endResponse(res: ResponseType): void;
    responseWrite(res: ResponseType, data: string): void;
    setSSEHeaders(res: ResponseType): void;
    closeConnection(res: ResponseType, code: number, message: string): void;

    listen(app: ServerAppType, port: number, hostname: string): Promise<void>;
    closeAllConnections(app: ServerAppType): MaybePromise<any>;
    close(app: ServerAppType): Promise<void>;

};

export type RxServerAuthData<AuthType> = {
    data: AuthType;
    validUntil: number;
};

/**
 * Returns the auth state by the given request headers.
 * Throws if auth not valid.
 */
export type RxServerAuthHandler<AuthType> =
    (headers: IncomingHttpHeaders) => MaybePromise<RxServerAuthData<AuthType>>;

/**
 * Modifies a given query in a way to limit the results
 * to what the authenticated user is allowed to see.
 * For example the query selector
 * input: {
 *   selector: {
 *     myField: { $gt: 100 }
 *   }
 * }
 * could be modified to restrict the results to only return
 * documents that are "owned" by the user
 * return: {
 *   selector: {
 *     myField: { $gt: 100 },
 *     userId: { $eq: authData.userId }
 *   }
 * }
 * 
 * 
 */
export type RxServerQueryModifier<AuthType, RxDocType> = (
    authData: RxServerAuthData<AuthType>,
    query: FilledMangoQuery<RxDocType>
) => FilledMangoQuery<RxDocType>;

/**
 * Validates if a given change is allowed to be performed on the server.
 * Returns true if allowed, false if not.
 * If a client tries to make a non-allowed change,
 * the client will be disconnected.
 */
export type RxServerChangeValidator<AuthType, RxDocType> = (
    authData: RxServerAuthData<AuthType>,
    change: RxReplicationWriteToMasterRow<RxDocType>
) => boolean;


export interface RxServerEndpoint<AuthType, RxDocType> {
    collection: RxCollection<RxDocType>;
    name: string;
    type: 'replication' | 'rest' | string;
    urlPath: string;
    queryModifier?: RxServerQueryModifier<AuthType, RxDocType>;
    changeValidator?: RxServerChangeValidator<AuthType, RxDocType>;
};
