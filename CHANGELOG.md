# Changelog

## Unreleased

### Bug Fixes

- Fix REST endpoint `/set` not protecting `serverOnlyFields` from client overwrites. Clients could include server-only fields in write requests to `/set`, and those values would be stored directly instead of being ignored. The handler now uses `mergeServerDocumentFields` (consistent with the replication endpoint) to ensure server-only field values are always preserved from the server-side document, not taken from client input.
- Fix missing `await` in `RxRestClient.get()`, `RxRestClient.set()`, and `RxRestClient.delete()` methods. The `postRequest()` call was not awaited before calling `handleError()`, which caused server errors (e.g. 403 Forbidden from `changeValidator`) to be silently swallowed instead of thrown to the caller.
- Fix conflict handling for new documents pushed via replication when `serverOnlyFields` are configured. `mergeServerDocumentFieldsMonad` incorrectly transformed a falsy `assumedMasterState` (used for new document inserts) into an object and set server-only fields to `null` on `newDocumentState`, causing schema validation failures and false conflicts.
- Fix REST `/delete` endpoint returning 403 Forbidden when `serverOnlyFields` is configured. The delete handler passed full documents (including server-only fields) to the `changeValidator`, which always rejected them because the wrapper checks for the presence of server-only fields. Now the server-only fields are stripped before validation, consistent with the `/set` endpoint behavior.
- Fix REST `/set` endpoint bypassing the `changeValidator` for inserts. When a client sent a document whose primary key did not yet exist on the server, the handler inserted the document without consulting the `changeValidator`, allowing clients to create documents the validator would have rejected. The validator is now called for inserts as well, with `assumedMasterState: undefined` as expected by the `RxServerChangeValidator` contract.
