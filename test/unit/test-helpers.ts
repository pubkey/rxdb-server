
import {
    type RxServerAuthHandler
} from '../../plugins/server/index.mjs';
import type { IncomingHttpHeaders } from 'node:http';
import { RxServerQueryModifier } from '../../src/plugins/server';
import { HumanDocumentType } from 'rxdb/plugins/test-utils';
import getPort from 'get-port';

export async function nextPort(): Promise<number> {
    return getPort();
}


export const urlSubPaths = ['pull', 'push', 'pullStream'] as const;

export type AuthType = {
    userid: string;
};

export const authHandler: RxServerAuthHandler<AuthType> = (requestHeaders: IncomingHttpHeaders) => {
    if (requestHeaders.authorization === 'is-valid') {
        return {
            validUntil: Date.now() + 100000, data: {
                userid: requestHeaders.userid as string
            }
        };
    } else {
        throw new Error('auth not valid');
    }
};
export const headers = {
    Authorization: 'is-valid',
    userid: 'alice'
};


export const queryModifier: RxServerQueryModifier<AuthType, HumanDocumentType> = (authData, query) => {
    query.selector.firstName = { $eq: authData.data.userid };
    return query;
};

export function customFetchWithFixedHeaders(headers: any) {
    function customFetch(url: string | URL, options: any = {}) {
        // Ensure options object exists and headers property is initialized
        options.headers = {
            ...headers,              // include default custom headers
            ...(options.headers || {})            // merge any headers passed in the function call
        };

        // Call the original fetch with the modified options
        return fetch(url, options);
    }
    return customFetch;
}
