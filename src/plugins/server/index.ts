import { ensureNotFalsy, flatClone } from 'rxdb/plugins/utils';
import { RxServer } from './rx-server.ts';
import { RxServerAuthHandler, RxServerOptions } from './types.ts';

export * from './types.ts';
export * from './endpoint-replication.ts';
export * from './endpoint-rest.ts';
export * from './helper.ts';
export * from './performance-test.ts';

export async function createRxServer<ServerAdapterType, AuthType>(
    options: RxServerOptions<ServerAdapterType, AuthType>
): Promise<RxServer<ServerAdapterType, AuthType>> {
    options = flatClone(options);
    if (!options.serverApp) {
        options.serverApp = await options.adapter.create();
    }
    const userAuthHandler: RxServerAuthHandler<AuthType> = options.authHandler ? options.authHandler : () => {
        return {
            data: {} as any,
            validUntil: Date.now() * 2
        };
    };
    const authHandler: RxServerAuthHandler<AuthType> = async (headers) => {
        const authData = await userAuthHandler(headers);
        if (authData.validUntil <= Date.now()) {
            throw new Error('auth data expired');
        }
        return authData;
    };

    const server = new RxServer<ServerAdapterType, AuthType>(
        options,
        authHandler,
        ensureNotFalsy(options.serverApp),
        options.cors
    );

    return server;
}
