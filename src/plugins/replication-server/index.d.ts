import { RxCollection, ReplicationPullOptions, ReplicationPushOptions, ById } from 'rxdb/plugins/core';
import { RxReplicationState } from 'rxdb/plugins/replication';
import { Subject } from 'rxjs';
import type { RxServerCheckpoint, ServerSyncOptions } from './types.ts';
export * from './types.ts';
export declare class RxServerReplicationState<RxDocType> extends RxReplicationState<RxDocType, RxServerCheckpoint> {
    readonly replicationIdentifier: string;
    readonly collection: RxCollection<RxDocType, unknown, unknown, unknown>;
    readonly pull?: ReplicationPullOptions<RxDocType, RxServerCheckpoint>;
    readonly push?: ReplicationPushOptions<RxDocType>;
    readonly live: boolean;
    retryTime: number;
    autoStart: boolean;
    headers: ById<string>;
    readonly outdatedClient$: Subject<void>;
    readonly unauthorized$: Subject<void>;
    readonly forbidden$: Subject<void>;
    constructor(replicationIdentifier: string, collection: RxCollection<RxDocType, unknown, unknown, unknown>, pull?: ReplicationPullOptions<RxDocType, RxServerCheckpoint>, push?: ReplicationPushOptions<RxDocType>, live?: boolean, retryTime?: number, autoStart?: boolean, headers?: ById<string>);
    setHeaders(headers: ById<string>): void;
}
export declare function replicateServer<RxDocType>(options: ServerSyncOptions<RxDocType>): RxServerReplicationState<RxDocType>;
