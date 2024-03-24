import {
    FilledMangoQuery,
    RxCollection,
    RxError,
    normalizeMangoQuery
} from 'rxdb/plugins/core';
import type { RxServer } from './rx-server.ts';
import type {
    RxServerChangeValidator,
    RxServerEndpoint,
    RxServerQueryModifier
} from './types.ts';
import { filter, mergeMap } from 'rxjs';
import {
    ensureNotFalsy,
    getFromMapOrThrow
} from 'rxdb/plugins/utils';

import {
    blockPreviousVersionPaths,
    docContainsServerOnlyFields,
    doesContainRegexQuerySelector,
    getAuthDataByRequest,
    getDocAllowedMatcher,
    removeServerOnlyFieldsMonad,
    setCors
} from './helper.ts';


export const REST_PATHS = [
    'query',
    'query/observe',
    'get',
    'set',
    'delete',

    // TODO
    /*
    'attachments/add',
    'attachments/delete',
    'events'
    */
] as const;


export class RxServerRestEndpoint<ServerAppType, AuthType, RxDocType> implements RxServerEndpoint<AuthType, RxDocType> {
    readonly type = 'rest';
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
        public readonly cors?: string
    ) {
        const adapter = server.adapter;
        setCors(this.server, [this.name].join('/'), cors);
        blockPreviousVersionPaths(this.server, [this.name].join('/'), collection.schema.version);

        this.urlPath = [this.name, collection.schema.version].join('/');
        const primaryPath = this.collection.schema.primaryPath;

        this.queryModifier = (authData, query) => {
            if (doesContainRegexQuerySelector(query.selector)) {
                throw new Error('$regex queries not allowed because of DOS-attacks');
            }
            return queryModifier(authData, query);
        }
        this.changeValidator = (authData, change) => {
            if (
                (
                    change.assumedMasterState &&
                    docContainsServerOnlyFields(serverOnlyFields, change.assumedMasterState)
                ) ||
                docContainsServerOnlyFields(serverOnlyFields, change.newDocumentState)
            ) {
                return false;
            }
            return changeValidator(authData, change);
        }
        const removeServerOnlyFields = removeServerOnlyFieldsMonad(this.serverOnlyFields);

        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/query', async (req, res) => {
            ensureNotFalsy(adapter.getRequestBody(req), 'req body is empty');
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            let useQuery: FilledMangoQuery<RxDocType>
            try {
                useQuery = this.queryModifier(
                    ensureNotFalsy(authData),
                    normalizeMangoQuery(
                        this.collection.schema.jsonSchema,
                        adapter.getRequestBody(req)
                    )
                );
            } catch (err) {
                adapter.closeConnection(res, 400, 'Bad Request');
                return;
            }
            const rxQuery = this.collection.find(useQuery as any);
            const result = await rxQuery.exec();
            adapter.setResponseHeader(res, 'Content-Type', 'application/json');
            adapter.endResponseJson(res, {
                documents: result.map(d => removeServerOnlyFields(d.toJSON()))
            });
        });

        /**
         * It is not possible to send data with server send events,
         * so we send the query as query parameter in base64
         * like ?query=e3NlbGVjdG9yOiB7fX0=
         */
        this.server.adapter.get(this.server.serverApp, '/' + this.urlPath + '/query/observe', async (req, res) => {
            let authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            adapter.setSSEHeaders(res);

            const useQuery: FilledMangoQuery<RxDocType> = this.queryModifier(
                ensureNotFalsy(authData),
                normalizeMangoQuery(
                    this.collection.schema.jsonSchema,
                    JSON.parse(atob(adapter.getRequestQuery(req).query as string))
                )
            );

            const rxQuery = this.collection.find(useQuery as any);
            const subscription = rxQuery.$.pipe(
                mergeMap(async (result) => {
                    const resultData = result.map(doc => removeServerOnlyFields(doc.toJSON()));

                    /**
                     * The auth-data might be expired
                     * so we re-run the auth parsing each time
                     * before emitting the new results.
                     */
                    try {
                        authData = await server.authHandler(adapter.getRequestHeaders(req)) as any;
                    } catch (err) {
                        adapter.closeConnection(res, 401, 'Unauthorized');
                        return null;
                    }

                    return resultData;
                }),
                filter(f => f !== null)
            ).subscribe(resultData => {
                adapter.responseWrite(res, 'data: ' + JSON.stringify(resultData) + '\n\n');
            });

            /**
             * @link https://youtu.be/0PcMuYGJPzM?si=AxkczxcMaUwhh8k9&t=363
             */
            adapter.onRequestClose(req, () => {
                subscription.unsubscribe();
                adapter.endResponse(req);
            });
        });


        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/get', async (req, res) => {
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            const ids: string[] = adapter.getRequestBody(req);

            const rxQuery = this.collection.findByIds(ids);
            const resultMap = await rxQuery.exec();
            const resultValues = Array.from(resultMap.values());
            const docMatcher = getDocAllowedMatcher(this, ensureNotFalsy(authData) as any);
            let useDocs = resultValues.map(d => d.toJSON());
            useDocs = useDocs.filter(d => docMatcher(d as any));
            useDocs = useDocs.map(d => removeServerOnlyFields(d))

            adapter.setResponseHeader(res, 'Content-Type', 'application/json');
            adapter.endResponseJson(res, {
                documents: useDocs
            });
        });

        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/set', async (req, res) => {
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            const docDataMatcherWrite = getDocAllowedMatcher(this, ensureNotFalsy(authData) as any);

            let docsData: RxDocType[] = adapter.getRequestBody(req);

            for (const docData of docsData) {
                const allowed = docDataMatcherWrite(docData as any);
                if (!allowed) {
                    adapter.closeConnection(res, 403, 'Forbidden');
                    return;
                }
            }

            function onWriteError(err: RxError, docData: RxDocType) {
                if (err.rxdb && err.code === 'CONFLICT') {
                    // just retry on conflicts
                    docsData.push(docData);
                } else {
                    adapter.closeConnection(res, 500, 'Internal Server Error');
                    throw err;
                }
            }

            while (docsData.length > 0) {
                const promises: Promise<any>[] = [];
                const docs = await collection.findByIds(docsData.map(d => (d as any)[primaryPath])).exec();
                let useDocsData = docsData.slice();
                docsData = [];
                for (const docData of useDocsData) {
                    const id = (docData as any)[primaryPath];
                    const doc = docs.get(id);
                    if (!doc) {
                        promises.push(this.collection.insert(docData).catch(err => onWriteError(err, docData)));
                    } else {
                        const isAllowed = this.changeValidator(authData, {
                            newDocumentState: removeServerOnlyFields(docData as any),
                            assumedMasterState: removeServerOnlyFields(doc.toJSON(true))
                        });
                        if (!isAllowed) {
                            adapter.closeConnection(res, 403, 'Forbidden');
                            return;
                        }
                        promises.push(doc.patch(docData).catch(err => onWriteError(err, docData)));
                    }
                }
                await Promise.all(promises);
            }

            adapter.setResponseHeader(res, 'Content-Type', 'application/json')
            adapter.endResponseJson(res, {});
        });

        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/delete', async (req, res) => {
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            const docDataMatcherWrite = getDocAllowedMatcher(this, ensureNotFalsy(authData));

            let ids: string[] = adapter.getRequestBody(req);
            while (ids.length > 0) {
                const useIds = ids.slice(0);
                ids = [];
                const promises: Promise<any>[] = [];
                const docsMap = await this.collection.findByIds(useIds).exec();
                for (const id of useIds) {
                    const doc = docsMap.get(id);
                    if (doc) {
                        const isAllowedDoc = docDataMatcherWrite(doc.toJSON(true) as any);
                        if (!isAllowedDoc) {
                            adapter.closeConnection(res, 403, 'Forbidden');
                            return;
                        }

                        const isAllowedChange = this.changeValidator(authData, {
                            newDocumentState: doc.toJSON(true) as any,
                            assumedMasterState: doc.toJSON(true) as any
                        });
                        if (!isAllowedChange) {
                            adapter.closeConnection(res, 403, 'Forbidden');
                            return;
                        }

                        promises.push(doc.remove().catch((err: RxError) => {
                            if (err.rxdb && err.code === 'CONFLICT') {
                                // just retry on conflicts
                                ids.push(id);
                            } else {
                                adapter.closeConnection(res, 500, 'Internal Server Error');
                                throw err;
                            }
                        }));
                    }
                }
                await Promise.all(promises);
            }
            adapter.setResponseHeader(res, 'Content-Type', 'application/json');
            adapter.endResponseJson(res, {});
        });
    }
}
