import { ById, MangoQuery } from 'rxdb/plugins/core';
import { Observable } from 'rxjs';
import { EventSource } from 'eventsource';
export declare class RxRestClient<RxDocType> {
    readonly endpointUrl: string;
    headers: ById<string>;
    readonly eventSource: typeof EventSource | any;
    constructor(endpointUrl: string, headers?: ById<string>, eventSource?: typeof EventSource | any);
    setHeaders(headers: ById<string>): void;
    handleError(response: any): void;
    query(query: MangoQuery<RxDocType>): Promise<{
        documents: RxDocType[];
    }>;
    observeQuery(query: MangoQuery<RxDocType>): Observable<RxDocType[]>;
    get(ids: string[]): Promise<{
        documents: RxDocType[];
    }>;
    set(docs: RxDocType[]): Promise<any>;
    delete(ids: string[]): Promise<any>;
}
export declare function createRestClient<RxDocType>(endpointUrl: string, headers: ById<string>, eventSource?: typeof EventSource | any): RxRestClient<RxDocType>;
export * from './utils.ts';
