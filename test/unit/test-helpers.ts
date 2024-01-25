
import {
    type RxServerAuthHandler
} from '../../plugins/server/index.mjs';
import type { IncomingHttpHeaders } from 'node:http';


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
