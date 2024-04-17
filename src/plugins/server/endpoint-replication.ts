import {
    FilledMangoQuery,
    RxCollection,
    RxReplicationHandler,
    RxReplicationWriteToMasterRow,
    StringKeys,
    prepareQuery,
    getChangedDocumentsSinceQuery,
    RxDocumentData
} from 'rxdb/plugins/core';
import { getReplicationHandlerByCollection } from 'rxdb/plugins/replication-websocket';
import type { RxServer } from './rx-server.ts';
import type {
    RxServerAuthData,
    RxServerChangeValidator,
    RxServerEndpoint,
    RxServerQueryModifier
} from './types.ts';
import { filter, mergeMap } from 'rxjs';
import {
    ensureNotFalsy,
    lastOfArray
} from 'rxdb/plugins/utils';

import {
    docContainsServerOnlyFields,
    doesContainRegexQuerySelector,
    getAuthDataByRequest,
    getDocAllowedMatcher,
    mergeServerDocumentFieldsMonad,
    removeServerOnlyFieldsMonad,
    setCors
} from './helper.ts';
import type { RxServerCheckpoint } from '../replication-server/types.ts';

export type RxReplicationEndpointMessageType = {
    id: string;
    method: StringKeys<RxReplicationHandler<any, any>> | 'auth';
    params: any[];
};

export class RxServerReplicationEndpoint<ServerAppType, AuthType, RxDocType> implements RxServerEndpoint<AuthType, RxDocType> {
    readonly type = 'replication';
    readonly urlPath: string;
    readonly changeValidator: RxServerChangeValidator<AuthType, RxDocType>;
    readonly queryModifier: RxServerQueryModifier<AuthType, RxDocType>;
    constructor(
        public readonly server: RxServer<ServerAppType, AuthType>,
        public readonly name: string,
        public readonly collection: RxCollection<RxDocType>,
        queryModifier: RxServerQueryModifier<AuthType, RxDocType>,
        changeValidator: RxServerChangeValidator<AuthType, RxDocType>,
        public readonly serverOnlyFields: string[],
        public readonly cors?: string,
    ) {
        const adapter = this.server.adapter;

        setCors(this.server, [this.name].join('/'), cors);
        blockPreviousReplicationVersionPaths(this.server, [this.name].join('/'), collection.schema.version);

        this.urlPath = [this.name, collection.schema.version].join('/');

        const primaryPath = this.collection.schema.primaryPath;
        const replicationHandler: RxReplicationHandler<RxDocType, RxServerCheckpoint> = getReplicationHandlerByCollection<RxDocType>(this.server.database, collection.name);
        this.queryModifier = (authData, query) => {
            if (doesContainRegexQuerySelector(query.selector)) {
                throw new Error('$regex queries not allowed because of DOS-attacks');
            }
            return queryModifier(authData, query);
        }
        this.changeValidator = (authData, change) => {
            if (
                (change.assumedMasterState && docContainsServerOnlyFields(serverOnlyFields, change.assumedMasterState)) ||
                docContainsServerOnlyFields(serverOnlyFields, change.newDocumentState)
            ) {
                return false;
            }
            return changeValidator(authData, change);
        }
        const removeServerOnlyFields = removeServerOnlyFieldsMonad<RxDocType>(this.serverOnlyFields);
        const mergeServerDocumentFields = mergeServerDocumentFieldsMonad<RxDocType>(this.serverOnlyFields);

        this.server.adapter.get(this.server.serverApp, '/' + this.urlPath + '/pull', async (req: any, res: any) => {
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            const urlQuery = adapter.getRequestQuery(req);
            const id = urlQuery.id ? urlQuery.id as string : '';
            const lwt = urlQuery.lwt ? parseFloat(urlQuery.lwt as any) : 0;
            const limit = urlQuery.limit ? parseFloat(urlQuery.limit as any) : 1;
            const plainQuery = getChangedDocumentsSinceQuery<RxDocType, RxServerCheckpoint>(
                this.collection.storageInstance,
                limit,
                { id, lwt }
            );
            const useQueryChanges: FilledMangoQuery<RxDocType> = this.queryModifier(
                ensureNotFalsy(authData),
                plainQuery
            );
            const prepared = prepareQuery<RxDocType>(
                this.collection.schema.jsonSchema,
                useQueryChanges
            );
            const result = await this.collection.storageInstance.query(prepared);

            const newCheckpoint: RxServerCheckpoint = result.documents.length === 0 ? { id, lwt } : {
                id: ensureNotFalsy(lastOfArray(result.documents))[primaryPath] as string,
                lwt: ensureNotFalsy(lastOfArray(result.documents))._meta.lwt
            };
            const responseDocuments = result.documents.map(d => removeServerOnlyFields(d));
            adapter.setResponseHeader(res, 'Content-Type', 'application/json');
            adapter.endResponseJson(res, {
                documents: responseDocuments,
                checkpoint: newCheckpoint
            });
        });

        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/push', async (req: any, res: any) => {
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            const docDataMatcherWrite = getDocAllowedMatcher(this, ensureNotFalsy(authData as any));
            const rows: RxReplicationWriteToMasterRow<RxDocType>[] = adapter.getRequestBody(req);
            const ids: string[] = [];
            rows.forEach(row => ids.push((row.newDocumentState as any)[primaryPath]));

            for (const row of rows) {
                // TODO remove this check
                if (row.assumedMasterState && (row.assumedMasterState as any)._meta) {
                    throw new Error('body document contains meta!');
                }
            }

            // ensure all writes are allowed
            const nonAllowedRow = rows.find(row => {
                if (
                    !docDataMatcherWrite(row.newDocumentState as any) ||
                    (row.assumedMasterState && !docDataMatcherWrite(row.assumedMasterState as any))
                ) {
                    return true;
                }
            });
            if (nonAllowedRow) {
                adapter.closeConnection(res, 403, 'Forbidden');
                return;
            }
            let hasInvalidChange = false;

            const currentStateDocsArray = await this.collection.storageInstance.findDocumentsById(ids, true);
            const currentStateDocs = new Map<string, RxDocumentData<RxDocType>>();
            currentStateDocsArray.forEach(d => currentStateDocs.set((d as any)[primaryPath], d));

            const useRows: typeof rows = rows.map((row) => {
                const id = (row.newDocumentState as any)[primaryPath];
                const isChangeValid = this.changeValidator(ensureNotFalsy(authData), {
                    newDocumentState: removeServerOnlyFields(row.newDocumentState),
                    assumedMasterState: removeServerOnlyFields(row.assumedMasterState)
                });
                if (!isChangeValid) {
                    hasInvalidChange = true;
                }

                const serverDoc = currentStateDocs.get(id);
                return {
                    newDocumentState: mergeServerDocumentFields(row.newDocumentState, serverDoc),
                    assumedMasterState: mergeServerDocumentFields(row.assumedMasterState as any, serverDoc)
                } as typeof row;
            });
            if (hasInvalidChange) {
                adapter.closeConnection(res, 403, 'Forbidden');
                return;
            }

            const conflicts = await replicationHandler.masterWrite(useRows);

            adapter.setResponseHeader(res, 'Content-Type', 'application/json');
            adapter.endResponseJson(res, conflicts);
        });
        this.server.adapter.get(this.server.serverApp, '/' + this.urlPath + '/pullStream', async (req, res) => {

            const authData = await getAuthDataByRequest<AuthType, any, any>(this.server, req, res);
            if (!authData) { return; }

            adapter.setSSEHeaders(res);
            const docDataMatcherStream = getDocAllowedMatcher(this, ensureNotFalsy(authData));
            const subscription = replicationHandler.masterChangeStream$.pipe(
                mergeMap(async (changes) => {
                    /**
                     * The auth-data might be expired
                     * so we re-run the auth parsing each time
                     * before emitting an event.
                     */
                    let authData: RxServerAuthData<AuthType>;
                    try {
                        authData = await server.authHandler(adapter.getRequestHeaders(req));
                    } catch (err) {
                        adapter.closeConnection(res, 401, 'Unauthorized');
                        return null;
                    }

                    if (changes === 'RESYNC') {
                        return changes;
                    } else {
                        const useDocs = changes.documents.filter(d => docDataMatcherStream(d as any));
                        return {
                            documents: useDocs,
                            checkpoint: changes.checkpoint
                        };
                    }
                }),
                filter(f => f !== null && (f === 'RESYNC' || f.documents.length > 0))
            ).subscribe(filteredAndModified => {
                if (filteredAndModified === 'RESYNC') {
                    adapter.responseWrite(res, 'data: ' + JSON.stringify(filteredAndModified) + '\n\n');
                } else {
                    const responseDocuments = ensureNotFalsy(filteredAndModified).documents.map(d => removeServerOnlyFields(d as any));
                    adapter.responseWrite(
                        res,
                        'data: ' + JSON.stringify({
                            documents: responseDocuments,
                            checkpoint: ensureNotFalsy(filteredAndModified).checkpoint
                        }) + '\n\n'
                    );
                }

            });

            /**
             * @link https://youtu.be/0PcMuYGJPzM?si=AxkczxcMaUwhh8k9&t=363
             */
            adapter.onRequestClose(req, () => {
                subscription.unsubscribe();
                adapter.endResponse(res);
            });
        });
    }
}


/**
 * "block" the previous version urls and send a 426 on them so that
 * the clients know they must update.
 */
export function blockPreviousReplicationVersionPaths(
    server: RxServer<any, any>,
    path: string,
    currentVersion: number

) {
    let v = 0;
    while (v < currentVersion) {
        const version = v;
        /**
         * Some adapters do not allow regex or handle them property (like Koa),
         * so to make it easier, use the hard-coded array of path parts.
         */
        [
            '',
            'pull',
            'push',
            'pullStream'
        ].forEach(subPath => {
            server.adapter.all(server.serverApp, '/' + path + '/' + version + '/' + subPath, (req, res) => {
                server.adapter.closeConnection(res, 426, 'Outdated version ' + version + ' (newest is ' + currentVersion + ')');
            });
        });
        v++;
    }
}
