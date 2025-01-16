import { ById, MangoQuery } from 'rxdb/plugins/core';
import { postRequest } from './utils.ts';
import { Observable, Subject } from 'rxjs';
import { EventSource } from 'eventsource';
import { customFetchWithFixedHeaders } from '../../utils.ts';

export class RxRestClient<RxDocType> {
    constructor(
        public readonly endpointUrl: string,
        public headers: ById<string> = {},
        public readonly eventSource: typeof EventSource | any = EventSource
    ) { }

    setHeaders(headers: ById<string>) {
        this.headers = headers;
    }

    handleError(response: any) {
        if (response.error) {
            throw new Error('Server returned an error ' + JSON.stringify(response));
        }
    }

    async query(query: MangoQuery<RxDocType>): Promise<{ documents: RxDocType[] }> {
        const response = await postRequest(
            this.endpointUrl + '/query',
            query,
            this.headers
        );
        this.handleError(response);
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
                fetch: customFetchWithFixedHeaders(this.headers)
            }
        );
        eventSource.onmessage = event => {
            const eventData = JSON.parse(event.data);
            result.next(eventData);
        };
        return result.asObservable();
    }

    get(ids: string[]): Promise<{ documents: RxDocType[] }> {
        const response = postRequest(
            this.endpointUrl + '/get',
            ids,
            this.headers
        );
        this.handleError(response);
        return response;
    }

    set(docs: RxDocType[]) {
        const response = postRequest(
            this.endpointUrl + '/set',
            docs,
            this.headers
        );
        this.handleError(response);
        return response;
    }

    delete(ids: string[]) {
        const response = postRequest(
            this.endpointUrl + '/delete',
            ids,
            this.headers
        );
        this.handleError(response);
        return response;
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
