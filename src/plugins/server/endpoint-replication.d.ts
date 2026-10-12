import { RxCollection, RxReplicationHandler, StringKeys } from 'rxdb/plugins/core';
import type { RxServer } from './rx-server.ts';
import type { RxServerChangeValidator, RxServerEndpoint, RxServerQueryModifier } from './types.ts';
export type RxReplicationEndpointMessageType = {
    id: string;
    method: StringKeys<RxReplicationHandler<any, any>> | 'auth';
    params: any[];
};
export declare class RxServerReplicationEndpoint<ServerAppType, AuthType, RxDocType> implements RxServerEndpoint<AuthType, RxDocType> {
    readonly server: RxServer<ServerAppType, AuthType>;
    readonly name: string;
    readonly collection: RxCollection<RxDocType>;
    readonly serverOnlyFields: string[];
    readonly cors?: string | undefined;
    readonly type = "replication";
    readonly urlPath: string;
    readonly changeValidator: RxServerChangeValidator<AuthType, RxDocType>;
    readonly queryModifier: RxServerQueryModifier<AuthType, RxDocType>;
    constructor(server: RxServer<ServerAppType, AuthType>, name: string, collection: RxCollection<RxDocType>, queryModifier: RxServerQueryModifier<AuthType, RxDocType>, changeValidator: RxServerChangeValidator<AuthType, RxDocType>, serverOnlyFields: string[], cors?: string | undefined);
}
/**
 * "block" the previous version urls and send a 426 on them so that
 * the clients know they must update.
 */
export declare function blockPreviousReplicationVersionPaths(server: RxServer<any, any>, path: string, currentVersion: number): void;
