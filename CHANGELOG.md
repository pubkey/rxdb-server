# Changelog

## Unreleased

### Bug Fixes

- Fix conflict handling for new documents pushed via replication when `serverOnlyFields` are configured. `mergeServerDocumentFieldsMonad` incorrectly transformed a falsy `assumedMasterState` (used for new document inserts) into an object and set server-only fields to `null` on `newDocumentState`, causing schema validation failures and false conflicts.
- Fix REST `/delete` endpoint returning 403 Forbidden when `serverOnlyFields` is configured. The delete handler passed full documents (including server-only fields) to the `changeValidator`, which always rejected them because the wrapper checks for the presence of server-only fields. Now the server-only fields are stripped before validation, consistent with the `/set` endpoint behavior.
