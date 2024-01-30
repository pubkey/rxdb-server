import { ensureNotFalsy, flatClone } from 'rxdb/plugins/utils';
import { RxServer } from './rx-server.ts';
import { RxServerAuthHandler, RxServerOptions } from './types.ts';
import express from 'express';
import {
    Server as HttpServer
} from 'http';

export * from './types.ts';
export * from './endpoint-replication.ts';
export * from './endpoint-rest.ts';
export * from './helper.ts';

export async function startRxServer<AuthType>(options: RxServerOptions<AuthType>): Promise<RxServer<AuthType>> {
    options = flatClone(options);
    if (!options.serverApp) {
        const app = express();
        options.serverApp = app;
    }

    options.serverApp.use(express.json());


    const httpServer: HttpServer = await new Promise((res, rej) => {
        const hostname = options.hostname ? options.hostname : 'localhost';
        const ret = ensureNotFalsy(options.serverApp).listen(options.port, hostname, () => {
            res(ret);
        });
    });

    const authHandler: RxServerAuthHandler<AuthType> = options.authHandler ? options.authHandler : () => {
        return {
            data: {} as any,
            validUntil: Date.now() * 2
        };
    };

    const server = new RxServer<AuthType>(
        options.database,
        authHandler,
        httpServer,
        ensureNotFalsy(options.serverApp),
        options.cors
    );

    return server;
}
