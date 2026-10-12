import { RxServer } from './rx-server';
import type { RxServerAuthData, RxServerEndpoint } from './types';
import { MangoQuerySelector, RxDocumentData } from 'rxdb/plugins/core';
export declare function setCors(server: RxServer<any, any>, path: string, cors?: string): void;
export declare function getAuthDataByRequest<AuthType, RequestType, ResponseType>(server: RxServer<any, AuthType>, request: RequestType, response: ResponseType): Promise<RxServerAuthData<AuthType> | false>;
export declare function getDocAllowedMatcher<RxDocType, AuthType>(endpoint: RxServerEndpoint<AuthType, RxDocType>, authData: RxServerAuthData<AuthType>): any;
export declare function docContainsServerOnlyFields(serverOnlyFields: string[], doc: any): string | undefined;
/**
 * Returns a function that strips the given server-only fields from a client
 * document. This is used when accepting a NEW document from a client write to
 * make sure that server-only fields cannot be populated by the client.
 *
 * Unlike {@link removeServerOnlyFieldsMonad} this does not assign undefined to
 * RxDB internal meta fields (`_meta`, `_rev`, `_attachments`) so the result can
 * be safely passed to `RxCollection.insert()`.
 */
export declare function stripServerOnlyFieldsMonad<RxDocType>(serverOnlyFields: string[]): (docData: RxDocType | RxDocumentData<RxDocType>) => any;
export declare function removeServerOnlyFieldsMonad<RxDocType>(serverOnlyFields: string[]): (docData?: RxDocType | RxDocumentData<RxDocType>) => any;
export declare function mergeServerDocumentFieldsMonad<RxDocType>(serverOnlyFields: string[]): (clientDoc: RxDocType | RxDocumentData<RxDocType>, serverDoc?: RxDocType | RxDocumentData<RxDocType>) => any;
/**
 * $regex queries are dangerous because they can dos-attack the server.
 *
 * @param selector
 */
export declare function doesContainRegexQuerySelector(selector: MangoQuerySelector<any> | any): boolean;
