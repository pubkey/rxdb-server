import {
    ensureNotFalsy,
    flatClone,
    promiseWait,
    RxCollection,
    ReplicationPullOptions,
    ReplicationPushOptions,
    RxReplicationPullStreamItem,
    ById,
    addRxPlugin,
    newRxError,
    WithDeletedAndAttachments
} from 'rxdb/plugins/core';
import { RxDBLeaderElectionPlugin } from 'rxdb/plugins/leader-election';
import {
    RxReplicationState,
    startReplicationOnLeaderShip
} from 'rxdb/plugins/replication';

import { Subject } from 'rxjs';
import type {
    RxServerCheckpoint,
    ServerSyncOptions
} from './types.ts';
import { parseResponse } from './helpers.ts';
import EventSource from 'eventsource';

export * from './types.ts';

export class RxServerReplicationState<RxDocType> extends RxReplicationState<RxDocType, RxServerCheckpoint> {
    public readonly outdatedClient$ = new Subject<void>();
    public readonly unauthorized$ = new Subject<void>();
    public readonly forbidden$ = new Subject<void>();

    constructor(
        public readonly replicationIdentifier: string,
        public readonly collection: RxCollection<RxDocType>,
        public readonly pull?: ReplicationPullOptions<RxDocType, RxServerCheckpoint>,
        public readonly push?: ReplicationPushOptions<RxDocType>,
        public readonly live: boolean = true,
        public retryTime: number = 1000 * 5,
        public autoStart: boolean = true,
        public headers: ById<string> = {}
    ) {
        super(
            replicationIdentifier,
            collection,
            '_deleted',
            pull,
            push,
            live,
            retryTime,
            autoStart
        );

        this.onCancel.push(() => {
            this.outdatedClient$.complete();
            this.unauthorized$.complete();
            this.forbidden$.complete();
        });
    }

    setHeaders(headers: ById<string>): void {
        this.headers = flatClone(headers);
    }
}

export function replicateServer<RxDocType>(
    options: ServerSyncOptions<RxDocType>
): RxServerReplicationState<RxDocType> {

    if (!options.pull && !options.push) {
        throw newRxError('UT3', {
            collection: options.collection.name,
            args: {
                replicationIdentifier: options.replicationIdentifier
            }
        });
    }

    options.live = typeof options.live === 'undefined' ? true : options.live;
    options.waitForLeadership = typeof options.waitForLeadership === 'undefined' ? true : options.waitForLeadership;

    const collection = options.collection;
    addRxPlugin(RxDBLeaderElectionPlugin);

    const pullStream$: Subject<RxReplicationPullStreamItem<RxDocType, RxServerCheckpoint>> = new Subject();

    let replicationPrimitivesPull: ReplicationPullOptions<RxDocType, RxServerCheckpoint> | undefined;
    if (options.pull) {
        replicationPrimitivesPull = {
            async handler(checkpointOrNull, batchSize) {
                const lwt = checkpointOrNull && checkpointOrNull.lwt ? checkpointOrNull.lwt : 0;
                const id = checkpointOrNull && checkpointOrNull.id ? checkpointOrNull.id : '';
                const url = options.url + `/pull?lwt=${lwt}&id=${id}&limit=${batchSize}`;
                const response = await fetch(url, {
                    method: 'GET',
                    headers: Object.assign({
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }, replicationState.headers),
                });
                const data = await parseResponse(replicationState, response);
                return {
                    documents: data.documents,
                    checkpoint: data.checkpoint
                };
            },
            batchSize: ensureNotFalsy(options.pull).batchSize,
            modifier: ensureNotFalsy(options.pull).modifier,
            stream$: pullStream$.asObservable()
        };
    }

    let replicationPrimitivesPush: ReplicationPushOptions<RxDocType> | undefined;
    if (options.push) {
        replicationPrimitivesPush = {
            async handler(changeRows) {
                const response = await fetch(options.url + '/push', {
                    method: 'POST',
                    headers: Object.assign({
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }, replicationState.headers),
                    body: JSON.stringify(changeRows)
                });
                const conflictsArray = await parseResponse(replicationState, response);
                return conflictsArray;
            },
            batchSize: options.push.batchSize,
            modifier: options.push.modifier
        };
    }

    const replicationState = new RxServerReplicationState<RxDocType>(
        options.replicationIdentifier,
        collection,
        replicationPrimitivesPull,
        replicationPrimitivesPush,
        options.live,
        options.retryTime,
        options.autoStart,
        options.headers
    );

    /**
     * Use long polling to get live changes for the pull.stream$
     */
    if (options.live && options.pull) {
        const startBefore = replicationState.start.bind(replicationState);
        replicationState.start = async () => {
            const useEventSource: typeof EventSource = options.eventSource ? options.eventSource : EventSource;
            let eventSource: EventSource;
            const refreshEventSource = () => {
                eventSource = new useEventSource(options.url + '/pullStream', {
                    withCredentials: true,
                    /**
                     * Sending headers is not supported by the Browser EventSource API,
                     * only by the npm module we use. In react-native you might have
                     * to set another EventSource implementation.
                     * @link https://www.npmjs.com/package/eventsource
                     */
                    headers: replicationState.headers
                });
                // TODO check for 426 errors and handle them
                eventSource.onerror = (err) => {
                    if (err.status === 401) {
                        replicationState.unauthorized$.next();
                        eventSource.close();
                        promiseWait(replicationState.retryTime).then(() => refreshEventSource());
                    } else {
                        pullStream$.next('RESYNC');
                    }
                };
                eventSource.onopen = (x) => {
                    pullStream$.next('RESYNC');
                }
                eventSource.onmessage = event => {
                    const eventData: { documents: WithDeletedAndAttachments<RxDocType>[]; checkpoint: RxServerCheckpoint; } = JSON.parse(event.data);
                    pullStream$.next({
                        documents: eventData.documents,
                        checkpoint: eventData.checkpoint
                    });
                };
            }
            refreshEventSource();

            replicationState.onCancel.push(() => eventSource && eventSource.close());
            return startBefore();
        };
    }

    startReplicationOnLeaderShip(options.waitForLeadership, replicationState);

    return replicationState;
}
