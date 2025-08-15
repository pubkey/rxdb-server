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
        serverApp.use('/' + path + '/*splat', expressCors({
            origin: cors,
            // some legacy browsers (IE11, various SmartTVs) choke on 204
            optionsSuccessStatus: 200
        }));
    },

    getRequestBody(req: Request) {
        return req.body;
    },
    getRequestHeaders(req: Request) {
        return req.headers as any;
    },
    getRequestQuery(req: Request) {
        return req.query;
    },
    onRequestClose(req: Request, fn) {
        req.on('close', () => {
            fn();
        });
    },

    setResponseHeader(res: Response, k: string, v: string) {
        res.setHeader(k, v);
    },
    responseWrite(res: Response, data: string) {
        res.write(data);
    },
    endResponseJson(res: Response, data: any) {
        res.json(data);
    },
    endResponse(res: Response) {
        res.end();
    },
    async closeConnection(response: Response, code: number, message: string) {
        const responseWrite = {
            code,
            error: true,
            message
        };
        response.status(code);
        response.set("Connection", "close");
        await response.write(JSON.stringify(responseWrite));
        response.end();
    },
    setSSEHeaders(res: Response) {
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
    },
    async closeAllConnections(serverApp) {
        const httpServer = HTTP_SERVER_BY_EXPRESS.get(serverApp);
        if (httpServer) {
            await httpServer.closeAllConnections();
        }
    }
};
