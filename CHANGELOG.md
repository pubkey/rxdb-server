# Changelog

## Unreleased

### Bug Fixes

- **auth-handler**: Fix `getAuthDataByRequest()` not checking the `validUntil` field of auth data. Previously, expired auth tokens (where `validUntil` was in the past) were accepted as valid. Now the server correctly rejects requests with expired auth data by returning a `401 Unauthorized` response.
