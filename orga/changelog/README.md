## Changelog Entries

Add one file per changelog entry to this folder. Each file should contain one or more changelog lines starting with `-`.

**File naming**: Use a descriptive filename ending in `.md`, for example:

- `fix-count-query-with-limit.md`
- `add-supabase-attachment-support.md`

**File content example**:

```
- FIX some bug that caused incorrect results
```

On rxdb release, all `.md` files in this folder (except this README) are read out from rxdb-server and merged into the changelog at rxdb core.

This approach prevents merge conflicts in `CHANGELOG.md` when multiple PRs are open at the same time.
