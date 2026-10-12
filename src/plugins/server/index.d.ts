import { RxServer } from './rx-server.ts';
import { RxServerOptions } from './types.ts';
export * from './types.ts';
export * from './endpoint-replication.ts';
export * from './endpoint-rest.ts';
export * from './helper.ts';
export * from './performance-test.ts';
export declare function createRxServer<ServerAdapterType, AuthType>(options: RxServerOptions<ServerAdapterType, AuthType>): Promise<RxServer<ServerAdapterType, AuthType>>;
