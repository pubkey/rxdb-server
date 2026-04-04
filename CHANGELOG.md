# Changelog

## Unreleased

### Bug Fixes

- **CORS**: Fixed wildcard `cors: '*'` (the default) producing an invalid CORS configuration when combined with `credentials: true`. The CORS specification forbids `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true`; browsers reject such responses for credentialed cross-origin requests. The Express adapter now reflects the request's `Origin` header instead of sending the literal `*`, which is spec-compliant and still allows every origin.
