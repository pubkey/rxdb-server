
import { ById } from 'rxdb/plugins/core';
import {
    type RxServerAuthHandler
} from '../../plugins/server/index.mjs';
import type { IncomingHttpHeaders } from 'node:http';
import { RxServerQueryModifier } from '../../src/plugins/server';
import { HumanDocumentType } from 'rxdb/plugins/test-utils';


export const urlSubPaths = ['pull', 'push', 'pullStream'] as const;

export type AuthType = {
    userid: string;
};

export const authHandler: RxServerAuthHandler<AuthType> = (requestHeaders: IncomingHttpHeaders) => {
    console.log('auth:');
    console.dir(requestHeaders);
    if (requestHeaders.authorization === 'is-valid') {
        console.log('auth valid!');
        return {
            validUntil: Date.now() + 100000, data: {
                userid: requestHeaders.userid as string
            }
        };
    } else {
        console.log('auth NOT valid!');
        throw new Error('auth not valid');
    }
};
export const headers = {
    Authorization: 'is-valid',
    userid: 'alice'
};


export async function postRequest(
    url: string,
    body: any,
    useHeaders: ById<string> = headers,
) {
    const request = await fetch(url, {
        method: 'POST',
        headers: Object.assign({
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }, useHeaders),
        body: JSON.stringify(body)
    });
    const response = await request.json();
    return response;
}

export const queryModifier: RxServerQueryModifier<AuthType, HumanDocumentType> = (authData, query) => {
    query.selector.firstName = { $eq: authData.data.userid };
    return query;
};
