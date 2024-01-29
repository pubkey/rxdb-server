
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
