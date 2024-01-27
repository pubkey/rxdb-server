import {
    FilledMangoQuery,
    RxCollection,
    RxError
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
    addAuthMiddleware,
    blockPreviousVersionPaths,
    closeConnection,
    getDocAllowedMatcher,
    setCors,
    writeSSEHeaders
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


export class RxServerRestEndpoint<AuthType, RxDocType> implements RxServerEndpoint<AuthType, RxDocType> {
    readonly type = 'rest';
    readonly urlPath: string;
    constructor(
        public readonly server: RxServer<AuthType>,
        public readonly collection: RxCollection<RxDocType>,
        public readonly queryModifier: RxServerQueryModifier<AuthType, RxDocType>,
        public readonly changeValidator: RxServerChangeValidator<AuthType, RxDocType>,
        public readonly cors?: string
    ) {
        setCors(this.server, [this.type, collection.name].join('/'), cors);
        blockPreviousVersionPaths(this.server, [this.type, collection.name].join('/'), collection.schema.version);

        this.urlPath = [this.type, collection.name, collection.schema.version].join('/');
        console.log('REST SERVER URL PATH: ' + this.urlPath);

        const primaryPath = this.collection.schema.primaryPath;
        const authDataByRequest = addAuthMiddleware(
            this.server,
            this.urlPath
        );

        this.server.expressApp.post('/' + this.urlPath + '/query', async (req, res) => {
            const authData = getFromMapOrThrow(authDataByRequest, req);
            const useQuery: FilledMangoQuery<RxDocType> = this.queryModifier(
                ensureNotFalsy(authData),
                req.body
            );
            const rxQuery = this.collection.find(useQuery as any);
            const result = await rxQuery.exec();
            res.setHeader('Content-Type', 'application/json');
            res.json({
                documents: result.map(d => d.toJSON())
            });
        });

        this.server.expressApp.post('/' + this.urlPath + '/query/observe', async (req, res) => {
            let authData = getFromMapOrThrow(authDataByRequest, req);
            writeSSEHeaders(res);

            const useQuery: FilledMangoQuery<RxDocType> = this.queryModifier(
                ensureNotFalsy(authData),
                req.body
            );
            const rxQuery = this.collection.find(useQuery as any);
            const subscription = rxQuery.$.pipe(
                mergeMap(async (result) => {
                    const resultData = result.map(doc => doc.toJSON());

                    /**
                     * The auth-data might be expired
                     * so we re-run the auth parsing each time
                     * before emitting the new results.
                     */
                    try {
                        authData = await server.authHandler(req.headers);
                    } catch (err) {
                        closeConnection(res, 401, 'Unauthorized');
                        return null;
                    }

                    console.log('S: emit to stream:');
                    console.dir(resultData);

                    return resultData;
                }),
                filter(f => f !== null)
            ).subscribe(resultData => {
                res.write('data: ' + JSON.stringify(resultData) + '\n\n');
            });

            /**
             * @link https://youtu.be/0PcMuYGJPzM?si=AxkczxcMaUwhh8k9&t=363
             */
            req.on('close', () => {
                subscription.unsubscribe();
                res.end();
            });
        });


        this.server.expressApp.post('/' + this.urlPath + '/get', async (req, res) => {
            const authData = getFromMapOrThrow(authDataByRequest, req);
            const ids: string[] = req.body;

            const rxQuery = this.collection.findByIds(ids);
            const resultMap = await rxQuery.exec();
            const resultValues = Array.from(resultMap.values());
            const docMatcher = getDocAllowedMatcher(this, ensureNotFalsy(authData));
            let useDocs = resultValues.map(d => d.toJSON());
            useDocs = useDocs.filter(d => docMatcher(d as any));

            res.setHeader('Content-Type', 'application/json');
            res.json({
                documents: useDocs
            });
        });

        this.server.expressApp.post('/' + this.urlPath + '/set', async (req, res) => {
            const authData = getFromMapOrThrow(authDataByRequest, req);
            const docDataMatcherWrite = getDocAllowedMatcher(this, ensureNotFalsy(authData));

            let docsData: RxDocType[] = req.body;

            for (const docData of docsData) {
                const allowed = docDataMatcherWrite(docData as any);
                if (!allowed) {
                    closeConnection(res, 403, 'Forbidden');
                    return;
                }
            }

            function onWriteError(err: RxError, docData: RxDocType) {
                if (err.rxdb && err.code === 'CONFLICT') {
                    // just retry on conflicts
                    docsData.push(docData);
                } else {
                    closeConnection(res, 500, 'Internal Server Error');
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
                            newDocumentState: docData as any,
                            assumedMasterState: doc.toJSON(true) as any
                        });
                        if (!isAllowed) {
                            closeConnection(res, 403, 'Forbidden');
                            return;
                        }
                        promises.push(doc.patch(docData).catch(err => onWriteError(err, docData)));
                    }
                }
                await Promise.all(promises);
            }

            res.setHeader('Content-Type', 'application/json');
            res.json({
            });
        });

        this.server.expressApp.post('/' + this.urlPath + '/delete', async (req, res) => {
            const authData = getFromMapOrThrow(authDataByRequest, req);
            const docDataMatcherWrite = getDocAllowedMatcher(this, ensureNotFalsy(authData));

            let ids: string[] = req.body;

            while (ids.length > 0) {
                const useIds = ids;
                ids = [];
                const promises: Promise<any>[] = [];
                const docsMap = await this.collection.findByIds(ids).exec();
                for (const id of useIds) {
                    const doc = docsMap.get(id);
                    if (doc) {
                        const isAllowed = docDataMatcherWrite(doc.toJSON(true) as any);
                        if (!isAllowed) {
                            closeConnection(res, 403, 'Forbidden');
                            return;
                        }
                        promises.push(doc.remove().catch((err: RxError) => {
                            if (err.rxdb && err.code === 'CONFLICT') {
                                // just retry on conflicts
                                ids.push(id);
                            } else {
                                closeConnection(res, 500, 'Internal Server Error');
                                throw err;
                            }
                        }));
                    }
                }
                await Promise.all(promises);
            }
            res.setHeader('Content-Type', 'application/json');
            res.json({});
        });
    }
}
