# Changelog

## UNRELEASED

### Bug Fixes

- **REST `/set` endpoint**: The `changeValidator` was not called when inserting new documents, only when updating existing ones. This allowed bypassing the `changeValidator` for inserts via the REST API. The `changeValidator` is now correctly called for both inserts and updates.
