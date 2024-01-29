import { ById, MangoQuery } from 'rxdb/plugins/core';
import { postRequest } from './utils.ts';
import { Observable, Subject } from 'rxjs';
import EventSource from 'eventsource';

export class RxRestClient<RxDocType> {
    constructor(
        public readonly endpointUrl: string,
        public headers: ById<string> = {},
        public readonly eventSource: typeof EventSource | any = EventSource
    ) { }

    setHeaders(headers: ById<string>) {
        this.headers = headers;
    }

    async query(query: MangoQuery<RxDocType>): Promise<{ documents: RxDocType[] }> {
        const response = await postRequest(
            this.endpointUrl + '/query',
            query,
            this.headers
        );
        console.dir(response);
        return response;
    }

    observeQuery(query: MangoQuery<RxDocType>): Observable<RxDocType[]> {
        const result = new Subject<RxDocType[]>;
        const queryAsBase64 = btoa(JSON.stringify(query));
        const eventSource: EventSource = new this.eventSource(
            this.endpointUrl + '/query/observe?query=' + queryAsBase64,
            {
                withCredentials: true,
                /**
                 * Sending headers is not supported by the Browser EventSource API,
                 * only by the npm module we use. In react-native you might have
                 * to set another EventSource implementation.
                 * @link https://www.npmjs.com/package/eventsource
                 */
                headers: this.headers
            });
        eventSource.onmessage = event => {
            const eventData = JSON.parse(event.data);
            result.next(eventData);
        };
        return result.asObservable();
    }

    get(ids: string[]): Promise<{ documents: RxDocType[] }> {
        return postRequest(
            this.endpointUrl + '/get',
            ids,
            this.headers
        );
    }

    set(docs: RxDocType[]) {
        return postRequest(
            this.endpointUrl + '/set',
            docs,
            this.headers
        );
    }

    delete(ids: string[]) {
        return postRequest(
            this.endpointUrl + '/delete',
            ids,
            this.headers
        );
    }
}

export function createRestClient<RxDocType>(
    endpointUrl: string,
    headers: ById<string>,
    eventSource: typeof EventSource | any = EventSource
) {

    return new RxRestClient<RxDocType>(
        endpointUrl,
        headers,
        eventSource
    );
}


export * from './utils.ts';