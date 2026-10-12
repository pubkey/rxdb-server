import type { RxServerAdapter } from '../server/types';
import type { Express } from 'express';
import { Request, Response } from 'express';
import { Server as HttpServer } from 'http';
export declare const HTTP_SERVER_BY_EXPRESS: WeakMap<Express, HttpServer<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>>;
export declare const RxServerAdapterExpress: RxServerAdapter<Express, Request, Response>;
