import type { RxServerAdapter } from '../server/types';
import type { Express } from 'express';
import express, { Request, Response } from 'express';
import {
    Server as HttpServer
} from 'http';
import expressCors from 'cors';
import { ensureNotFalsy, getFromMapOrThrow } from 'rxdb/plugins/core';

export const HTTP_SERVER_BY_EXPRESS = new WeakMap<Express, HttpServer>();

export const RxServerAdapterExpress: RxServerAdapter<Express, Request, Response> = {
    async create() {
        const app = express();
        app.use(express.json());
        return app;
    },
    setCors(serverApp, path, cors) {
        serverApp.options('/' + path + '/*', expressCors({
            origin: cors,
            // some legacy browsers (IE11, various SmartTVs) choke on 204
            optionsSuccessStatus: 200
        }));
    },
    get(serverApp, path, handler) {
        serverApp.get(path, handler);
    },
    post(serverApp, path, handler) {
        serverApp.post(path, handler);
    },
    all(serverApp, path, handler) {
        serverApp.all(path, handler);
    },
    async listen(serverApp, port, hostname) {
        const httpServer: HttpServer = await new Promise((res, rej) => {
            const ret = ensureNotFalsy(serverApp).listen(port, hostname, () => {
                res(ret);
            });
        });
        HTTP_SERVER_BY_EXPRESS.set(serverApp, httpServer);
    },
    async close(serverApp) {
        const httpServer = getFromMapOrThrow(HTTP_SERVER_BY_EXPRESS, serverApp);
        await new Promise<void>((res, rej) => {
            httpServer.close((err) => {
                if (err) { rej(err); } else { res(); }
            });
            /**
             * By default it will await all ongoing connections
             * before it closes. So we have to close it directly.
             * @link https://stackoverflow.com/a/36830072/3443137
             */
            setImmediate(() => httpServer.emit('close'));
        });
    }
};
