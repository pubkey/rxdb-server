import { RxServer } from './rx-server';
import type {
    Request,
    Response,
    NextFunction
} from 'express';
import type { RxServerAdapter, RxServerAuthData, RxServerEndpoint } from './types';
import {
    FilledMangoQuery,
    MangoQuerySelector,
    RxDocumentData,
    flatClone,
    getFromMapOrCreate,
    getQueryMatcher,
    normalizeMangoQuery,
    uniqueArray
} from 'rxdb/plugins/core';

export function setCors(
    server: RxServer<any, any>,
    path: string,
    cors?: string
) {
    let useCors = cors;
    if (!useCors) {
        useCors = server.cors;
    }
    if (useCors) {
        server.adapter.setCors(server.serverApp, path, useCors);
    }
}

/**
 * "block" the previous version urls and send a 426 on them so that
 * the clients know they must update.
 */
export function blockPreviousVersionPaths(
    server: RxServer<any, any>,
    path: string,
    currentVersion: number

) {
    let v = 0;
    while (v < currentVersion) {
        const version = v;
        server.adapter.all(server.serverApp, '/' + path + '/' + version + '/*', (req, res) => {
            server.adapter.closeConnection(res, 426, 'Outdated version ' + version + ' (newest is ' + currentVersion + ')');
        });
        v++;
    }
}



const AUTH_PER_REQUEST = new WeakMap<any, Promise<any>>();

export async function getAuthDataByRequest<AuthType, RequestType, ResponseType>(
    server: RxServer<any, AuthType>,
    request: RequestType,
    response: ResponseType
): Promise<RxServerAuthData<AuthType> | false> {
    return getFromMapOrCreate(
        AUTH_PER_REQUEST,
        request,
        async () => {
            try {
                const headers = server.adapter.getRequestHeaders(request);
                const authData = await server.authHandler(headers);
                return authData;
            } catch (err) {
                server.adapter.closeConnection(response, 401, 'Unauthorized');
                return false;
            }
        }
    );
};

const defaultMatchingQuery: FilledMangoQuery<any> = {
    selector: {},
    skip: 0,
    sort: []
} as const;

export function getDocAllowedMatcher<RxDocType, AuthType>(
    endpoint: RxServerEndpoint<AuthType, RxDocType>,
    authData: RxServerAuthData<AuthType>
) {
    const useQuery: FilledMangoQuery<RxDocType> = endpoint.queryModifier ? endpoint.queryModifier(
        authData,
        normalizeMangoQuery(
            endpoint.collection.schema.jsonSchema,
            {}
        )
    ) : defaultMatchingQuery;
    const docDataMatcher = getQueryMatcher(endpoint.collection.schema.jsonSchema, useQuery);
    return docDataMatcher;
}


export function docContainsServerOnlyFields(
    serverOnlyFields: string[],
    doc: any
) {
    const has = serverOnlyFields.find(field => {
        return typeof doc[field] !== 'undefined'
    });
    return has;
}

export function removeServerOnlyFieldsMonad<RxDocType>(serverOnlyFields: string[]) {
    const serverOnlyFieldsStencil: any = {
        _meta: undefined,
        _rev: undefined,
        _attachments: undefined
    };
    serverOnlyFields.forEach(field => serverOnlyFieldsStencil[field] = undefined);
    return (
        docData?: RxDocType | RxDocumentData<RxDocType>
    ) => {
        if (!docData) {
            return docData;
        }
        return Object.assign({}, docData, serverOnlyFieldsStencil);
    }
}

export function mergeServerDocumentFieldsMonad<RxDocType>(serverOnlyFields: string[]) {
    let useFields = serverOnlyFields.slice(0);
    // useFields.push('_rev');
    // useFields.push('_meta');
    // useFields.push('_attachments');
    useFields = uniqueArray(useFields);

    return (
        clientDoc: RxDocType | RxDocumentData<RxDocType>,
        serverDoc?: RxDocType | RxDocumentData<RxDocType>
    ) => {
        if (!serverDoc) {
            return clientDoc;
        }
        const ret = flatClone(clientDoc);
        useFields.forEach(field => {
            (ret as any)[field] = (serverDoc as any)[field];
        });
        return ret;
    }
}


/**
 * $regex queries are dangerous because they can dos-attack the server.
 * 
 * @param selector 
 */
export function doesContainRegexQuerySelector(selector: MangoQuerySelector<any> | any): boolean {
    if (!selector) {
        return false;
    }
    if (Array.isArray(selector)) {
        const found = !!selector.find(item => doesContainRegexQuerySelector(item));
        return found;
    }

    if (typeof selector !== 'object') {
        return false;
    }

    const entries = Object.entries(selector);
    for (const [key, value] of entries) {
        if (key === '$regex') {
            return true;
        } else {
            const has = doesContainRegexQuerySelector(value);
            if (has) {
                return true;
            }
        }
    }

    return false;
}
