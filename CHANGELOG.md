# Changelog

## Unreleased

### Bug Fixes

- **query-modifier:** Fix `/set` endpoint not checking existing document against queryModifier before allowing updates. Previously, a user could update another user's document by changing the ownership field to match their own queryModifier. Now the existing document is also validated against the queryModifier, consistent with the `/delete` endpoint and replication `/push` behavior.
