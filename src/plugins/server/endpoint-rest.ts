import {
    FilledMangoQuery,
    MangoQuery,
    RxCollection,
    RxError,
    normalizeMangoQuery
} from 'rxdb/plugins/core';
import type { RxServer } from './rx-server.ts';
import type {
    RxServerAuthData,
    RxServerChangeValidator,
    RxServerEndpoint,
    RxServerQueryModifier,
    RxServerRouteHandler
} from './types.ts';
import { concatMap, filter, takeWhile, tap } from 'rxjs';
import {
    ensureNotFalsy,
    getFromMapOrThrow
} from 'rxdb/plugins/utils';

import {
    docContainsServerOnlyFields,
    doesContainRegexQuerySelector,
    getAuthDataByRequest,
    getDocAllowedMatcher,
    mergeServerDocumentFieldsMonad,
    removeServerOnlyFieldsMonad,
    setCors,
    stripServerOnlyFieldsMonad
} from './helper.ts';


export const REST_PATHS = [
    'query',
    'query/observe',
    'get',
    'set',
    'patch',
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
        blockPreviousReplicationVersionPathsRest(this.server, [this.name].join('/'), collection.schema.version);

        this.urlPath = [this.name, collection.schema.version].join('/');
        const primaryPath = this.collection.schema.primaryPath;

        this.queryModifier = (authData, query) => {
            if (doesContainRegexQuerySelector(query.selector)) {
                throw new Error('$regex queries not allowed because of DOS-attacks');
            }
            return queryModifier(authData, query);
        }
        const prepareClientQuery = (authData: RxServerAuthData<AuthType>, clientQuery: any): FilledMangoQuery<RxDocType> => {
            if (doesQueryUseFields(clientQuery, serverOnlyFields)) {
                throw new Error('queries must not use serverOnlyFields');
            }
            const sortedQuery = serverOnlyFields.length > 0 && !clientQuery.sort ?
                { ...clientQuery, sort: [{ [primaryPath]: 'asc' }] } :
                clientQuery;
            return this.queryModifier(
                authData,
                normalizeMangoQuery(this.collection.schema.jsonSchema, sortedQuery)
            );
        };
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
        const mergeServerDocumentFields = mergeServerDocumentFieldsMonad<RxDocType>(this.serverOnlyFields);
        const stripServerOnlyFields = stripServerOnlyFieldsMonad<RxDocType>(this.serverOnlyFields);

        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/query', async (req, res) => {
            ensureNotFalsy(adapter.getRequestBody(req), 'req body is empty');
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            let useQuery: FilledMangoQuery<RxDocType>
            try {
                useQuery = prepareClientQuery(
                    ensureNotFalsy(authData),
                    adapter.getRequestBody(req)
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
            /**
             * The client can close the request while the authHandler runs.
             * The close event is then already emitted when the stream would be set up,
             * so the stream must not be started.
             */
            let requestClosed = false;
            adapter.onRequestClose(req, () => {
                requestClosed = true;
            });
            let authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }
            if (requestClosed) {
                adapter.endResponse(res);
                return;
            }

            // Run the queryModifier BEFORE setSSEHeaders so that a bad
            // request (e.g. a $regex query that the modifier wrapper
            // rejects to prevent DOS attacks) can still be answered
            // with a proper 400 response, mirroring the /query endpoint.
            let useQuery: FilledMangoQuery<RxDocType>;
            try {
                useQuery = prepareClientQuery(
                    ensureNotFalsy(authData),
                    JSON.parse(decodeQueryParam(adapter.getRequestQuery(req)))
                );
            } catch (err) {
                adapter.closeConnection(res, 400, 'Bad Request');
                return;
            }

            adapter.setSSEHeaders(res);

            const rxQuery = this.collection.find(useQuery as any);
            const subscription = rxQuery.$.pipe(
                concatMap(async (result) => {
                    const resultData = result.map(doc => removeServerOnlyFields(doc.toJSON()));

                    /**
                     * The auth-data might be expired
                     * so we re-run the auth parsing each time
                     * before emitting the new results.
                     */
                    try {
                        authData = await server.authHandler(adapter.getRequestHeaders(req)) as any;
                    } catch (err) {
                        /**
                         * The SSE headers are already sent, so no 401 can be returned here.
                         * Instead the stream is ended, the client reconnects
                         * and then gets the 401 response on the new request.
                         */
                        return null;
                    }

                    return resultData;
                }),
                takeWhile(f => f !== null),
                tap({ complete: () => adapter.endResponse(res) }),
                filter(f => f !== null)
            ).subscribe(resultData => {
                adapter.responseWrite(res, 'data: ' + JSON.stringify(resultData) + '\n\n');
            });

            /**
             * @link https://youtu.be/0PcMuYGJPzM?si=AxkczxcMaUwhh8k9&t=363
             */
            adapter.onRequestClose(req, () => {
                subscription.unsubscribe();
                adapter.endResponse(res);
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

        const setDocuments: RxServerRouteHandler = async (req, res) => {
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            const docDataMatcherWrite = getDocAllowedMatcher(this, ensureNotFalsy(authData) as any);

            let docsData: RxDocType[] = adapter.getRequestBody(req);

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
                const writes: (() => Promise<any>)[] = [];
                const ids = docsData.map(d => (d as any)[primaryPath]);
                const docs = await collection.findByIds(ids).exec();
                const storedDocs = await collection.storageInstance.findDocumentsById(ids, true);
                if (storedDocs.some(d => !docDataMatcherWrite(d as any))) {
                    adapter.closeConnection(res, 403, 'Forbidden');
                    return;
                }
                let useDocsData = docsData.slice();
                docsData = [];
                for (const docData of useDocsData) {
                    const id = (docData as any)[primaryPath];
                    const doc = docs.get(id);
                    if (!doc) {
                        // Run the changeValidator for new document inserts as
                        // well. Previously the validator was only invoked for
                        // updates, so a changeValidator that rejected writes
                        // had no effect on inserts via /set, which is
                        // inconsistent with the replication endpoint and the
                        // documented contract that the validator gates all
                        // changes.
                        const isAllowed = this.changeValidator(authData, {
                            newDocumentState: removeServerOnlyFields(docData as any),
                            assumedMasterState: undefined
                        });
                        if (!isAllowed) {
                            adapter.closeConnection(res, 403, 'Forbidden');
                            return;
                        }
                        // Strip server-only fields from the client doc before
                        // inserting. Without this, a client could populate
                        // server-only ("readonly") fields when creating a new
                        // document via /set, which contradicts the documented
                        // behavior that clients cannot do writes where one of
                        // the serverOnlyFields is set.
                        const mergedDocData = stripServerOnlyFields(
                            mergeServerDocumentFields(docData, undefined) as RxDocType
                        );
                        if (!docDataMatcherWrite(mergedDocData as any)) {
                            adapter.closeConnection(res, 403, 'Forbidden');
                            return;
                        }
                        writes.push(() => this.collection.insert(mergedDocData).catch(err => onWriteError(err, mergedDocData)));
                    } else {
                        /**
                         * The request body can contain only some fields of the document.
                         * The checks must run on the document state that is stored
                         * after the write, not only on the sent fields.
                         */
                        const storedDocData = doc.toJSON(true) as any;
                        const mergedDocData = mergeServerDocumentFields(
                            { ...doc.toJSON(false), ...docData } as RxDocType,
                            storedDocData
                        );
                        const isAllowed = this.changeValidator(authData, {
                            newDocumentState: removeServerOnlyFields(mergedDocData as any),
                            assumedMasterState: removeServerOnlyFields(storedDocData)
                        });
                        if (!isAllowed) {
                            adapter.closeConnection(res, 403, 'Forbidden');
                            return;
                        }
                        if (!docDataMatcherWrite(mergedDocData as any)) {
                            adapter.closeConnection(res, 403, 'Forbidden');
                            return;
                        }
                        writes.push(() => doc.patch(mergedDocData).catch(err => onWriteError(err, docData)));
                    }
                }
                await Promise.all(writes.map(write => write()));
            }

            adapter.setResponseHeader(res, 'Content-Type', 'application/json')
            adapter.endResponseJson(res, {});
        };
        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/set', setDocuments);
        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/patch', setDocuments);

        this.server.adapter.post(this.server.serverApp, '/' + this.urlPath + '/delete', async (req, res) => {
            const authData = await getAuthDataByRequest(this.server, req, res);
            if (!authData) { return; }

            const docDataMatcherWrite = getDocAllowedMatcher(this, ensureNotFalsy(authData));

            let ids: string[] = adapter.getRequestBody(req);
            while (ids.length > 0) {
                const useIds = ids.slice(0);
                ids = [];
                const writes: (() => Promise<any>)[] = [];
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
                            newDocumentState: removeServerOnlyFields({ ...doc.toJSON(true), _deleted: true }) as any,
                            assumedMasterState: removeServerOnlyFields(doc.toJSON(true)) as any
                        });
                        if (!isAllowedChange) {
                            adapter.closeConnection(res, 403, 'Forbidden');
                            return;
                        }

                        writes.push(() => doc.remove().catch((err: RxError) => {
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
                await Promise.all(writes.map(write => write()));
            }
            adapter.setResponseHeader(res, 'Content-Type', 'application/json');
            adapter.endResponseJson(res, {});
        });
    }
}


function isFieldPath(path: string, fields: string[]): boolean {
    return fields.some(field => path === field || path.startsWith(field + '.'));
}

function doesSelectorUseFields(selector: any, fields: string[]): boolean {
    if (Array.isArray(selector)) {
        return selector.some(item => doesSelectorUseFields(item, fields));
    }
    if (!selector || typeof selector !== 'object') {
        return false;
    }
    return Object.entries(selector).some(([key, value]) => {
        if (key.startsWith('$')) {
            return doesSelectorUseFields(value, fields);
        }
        return isFieldPath(key, fields);
    });
}

function doesQueryUseFields(query: MangoQuery<any>, fields: string[]): boolean {
    if (fields.length === 0) {
        return false;
    }
    const index = query.index ? ([] as string[]).concat(query.index) : [];
    return doesSelectorUseFields(query.selector, fields) ||
        (query.sort || []).some(sortPart => Object.keys(sortPart).some(key => isFieldPath(key, fields))) ||
        index.some(key => isFieldPath(key, fields));
}

/**
 * "block" the previous version urls and send a 426 on them so that
 * the clients know they must update.
 */
export function blockPreviousReplicationVersionPathsRest(
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
            'query',
            'query/observe',
            'get',
            'set',
            'patch',
            'delete'
        ].forEach(subPath => {
            server.adapter.all(server.serverApp, '/' + path + '/' + version + '/' + subPath, (req, res) => {
                server.adapter.closeConnection(res, 426, 'Outdated version ' + version + ' (newest is ' + currentVersion + ')');
            });
        });
        v++;
    }
}

function decodeQueryParam(urlQuery: { query: string; encoding?: string; }): string {
    const binary = atob(urlQuery.query);
    if (urlQuery.encoding !== 'utf8') {
        return binary;
    }
    return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}
