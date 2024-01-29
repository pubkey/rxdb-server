import { RxServer } from './rx-server';
import expressCors from 'cors';
import type {
    Request,
    Response,
    NextFunction
} from 'express';
import { RxServerAuthData, RxServerEndpoint } from './types';
import {
    FilledMangoQuery,
    MangoQuerySelector,
    RxReplicationWriteToMasterRow,
    flatClone,
    getQueryMatcher,
    normalizeMangoQuery
} from 'rxdb/plugins/core';

export function setCors(
    server: RxServer<any>,
    path: string,
    cors?: string
) {
    let useCors = cors;
    if (!useCors) {
        useCors = server.cors;
    }
    if (useCors) {
        server.expressApp.options('/' + path + '/*', expressCors({
            origin: useCors,
            // some legacy browsers (IE11, various SmartTVs) choke on 204
            optionsSuccessStatus: 200
        }));
    }
}

/**
 * "block" the previous version urls and send a 426 on them so that
 * the clients know they must update.
 */
export function blockPreviousVersionPaths(
    server: RxServer<any>,
    path: string,
    currentVersion: number

) {
    let v = 0;
    while (v < currentVersion) {
        const version = v;
        server.expressApp.all('/' + path + '/' + version + '/*', (req, res) => {
            console.log('S: autdated version ' + version);
            closeConnection(res, 426, 'Outdated version ' + version + ' (newest is ' + currentVersion + ')');
        });
        v++;
    }
}


export async function closeConnection(response: Response, code: number, message: string) {
    console.log('# CLOSE CONNECTION');
    const responseWrite = {
        code,
        error: true,
        message
    };

    console.log('close connection!');
    response.statusCode = code;
    response.set("Connection", "close");
    await response.write(JSON.stringify(responseWrite));
    response.end();
}


export function addAuthMiddleware<AuthType>(
    server: RxServer<AuthType>,
    path: string,
): WeakMap<Request, RxServerAuthData<AuthType>> {
    const authDataByRequest = new WeakMap<Request, RxServerAuthData<AuthType>>();
    async function auth(req: Request, res: Response, next: NextFunction) {
        console.log('-- AUTH 1 ' + req.path);
        try {
            const authData = await server.authHandler(req.headers);
            authDataByRequest.set(req, authData);
            console.log('-- AUTH 2');
            next();
        } catch (err) {
            console.log('-- AUTH ERR');
            closeConnection(res, 401, 'Unauthorized');
            return;
        }
        console.log('-- AUTH 3');

    }
    server.expressApp.all('/' + path + '/*', auth, function (req, res, next) {
        console.log('-- ALL 1');

        next();
    });
    return authDataByRequest;
}

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

export function writeSSEHeaders(res: Response) {
    res.writeHead(200, {
        /**
         * Use exact these headers to make is less likely
         * for people to have problems.
         * @link https://www.youtube.com/watch?v=0PcMuYGJPzM
         */
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        /**
         * Required for nginx
         * @link https://stackoverflow.com/q/61029079/3443137
         */
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
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


/**
 * $regex queries are dangerous because they can dos-attach the 
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


    console.dir(selector);
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
