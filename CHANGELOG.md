# Changelog

## Unreleased

### Bug Fixes

- **replication push endpoint**: Strip `serverOnlyFields` and internal fields (`_meta`, `_rev`, `_attachments`) from conflict documents returned by the `/push` endpoint. Previously, when a push conflict occurred, the server returned the full server document including server-only fields and internal metadata, leaking data that should not be visible to the client. The `/pull` and `/pullStream` endpoints already stripped these fields correctly.
