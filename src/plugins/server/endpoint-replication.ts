import {
    FilledMangoQuery,
    RxCollection,
    RxReplicationHandler,
    RxReplicationWriteToMasterRow,
    RxStorageDefaultCheckpoint,
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
    getFromMapOrThrow,
    lastOfArray
} from 'rxdb/plugins/utils';

import {
    addAuthMiddleware,
    blockPreviousVersionPaths,
    closeConnection,
    docContainsServerOnlyFields,
    doesContainRegexQuerySelector,
    getDocAllowedMatcher,
    mergeServerDocumentFieldsMonad,
    removeServerOnlyFieldsMonad,
    setCors,
    writeSSEHeaders
} from './helper.ts';

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
        setCors(this.server, [this.name].join('/'), cors);
        blockPreviousVersionPaths(this.server, [this.name].join('/'), collection.schema.version);

        this.urlPath = [this.name, collection.schema.version].join('/');

        const primaryPath = this.collection.schema.primaryPath;
        const replicationHandler = getReplicationHandlerByCollection(this.server.database, collection.name);
        const authDataByRequest = addAuthMiddleware(
            this.server,
            this.urlPath
        );

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
            const authData = getFromMapOrThrow(authDataByRequest, req);
            const id = req.query.id ? req.query.id as string : '';
            const lwt = req.query.lwt ? parseInt(req.query.lwt as any, 10) : 0;
            const limit = req.query.limit ? parseInt(req.query.limit as any, 10) : 1;
            const plainQuery = getChangedDocumentsSinceQuery<RxDocType, RxStorageDefaultCheckpoint>(
                this.collection.storageInstance,
                limit,
                { id, lwt }
            );
            const useQueryChanges: FilledMangoQuery<RxDocType> = this.queryModifier(
                ensureNotFalsy(authData as any),
                plainQuery
            );
            const prepared = prepareQuery<RxDocType>(
                this.collection.schema.jsonSchema,
                useQueryChanges
            );
            const result = await this.collection.storageInstance.query(prepared);

            const newCheckpoint = result.documents.length === 0 ? { id, lwt } : {
                id: ensureNotFalsy(lastOfArray(result.documents))[primaryPath],
                updatedAt: ensureNotFalsy(lastOfArray(result.documents))._meta.lwt
            };
            const responseDocuments = result.documents.map(d => removeServerOnlyFields(d));
            res.setHeader('Content-Type', 'application/json');
            res.json({
                documents: responseDocuments,
                checkpoint: newCheckpoint
            });
        });

        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/push', async (req: any, res: any) => {
            const authData = getFromMapOrThrow(authDataByRequest, req);
            const docDataMatcherWrite = getDocAllowedMatcher(this, ensureNotFalsy(authData as any));
            const rows: RxReplicationWriteToMasterRow<RxDocType>[] = req.body;
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
                closeConnection(res, 403, 'Forbidden');
                return;
            }
            let hasInvalidChange = false;

            const currentStateDocsArray = await this.collection.storageInstance.findDocumentsById(ids, true);
            const currentStateDocs = new Map<string, RxDocumentData<RxDocType>>();
            currentStateDocsArray.forEach(d => currentStateDocs.set((d as any)[primaryPath], d));

            const useRows: typeof rows = rows.map((row) => {
                const id = (row.newDocumentState as any)[primaryPath];
                const isChangeValid = this.changeValidator(ensureNotFalsy(authData as any), {
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
                closeConnection(res, 403, 'Forbidden');
                return;
            }

            const conflicts = await replicationHandler.masterWrite(useRows);

            res.setHeader('Content-Type', 'application/json');
            res.json(conflicts);
        });
        this.server.adapter.get(this.server.serverApp, '/' + this.urlPath + '/pullStream', async (req, res) => {
            writeSSEHeaders(res);

            const authData = getFromMapOrThrow(authDataByRequest, req);
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
                        authData = await server.authHandler(req.headers);
                    } catch (err) {
                        closeConnection(res, 401, 'Unauthorized');
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
                    res.write('data: ' + JSON.stringify(filteredAndModified) + '\n\n');
                } else {
                    const responseDocuments = ensureNotFalsy(filteredAndModified).documents.map(d => removeServerOnlyFields(d as any));
                    res.write('data: ' + JSON.stringify({ documents: responseDocuments, checkpoint: ensureNotFalsy(filteredAndModified).checkpoint }) + '\n\n');
                }

            });

            /**
             * @link https://youtu.be/0PcMuYGJPzM?si=AxkczxcMaUwhh8k9&t=363
             */
            req.on('close', () => {
                subscription.unsubscribe();
                res.end();
            });
        });
    }
}
