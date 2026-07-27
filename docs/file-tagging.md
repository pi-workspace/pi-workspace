# File and folder tagging

## Phase 1 contract

The Composer accepts `@` references to files and folders in the current Session's allowed Repository working paths. Selecting a result creates a structured inline reference while displaying the relative path. The persisted text remains canonical and backwards-compatible; file metadata is optional and unavailable references remain renderable. Paths that need whitespace or otherwise cannot be represented unquoted use an escaped JSON-quoted token such as `@@"src/my file.ts"`.

At the Agent boundary, references are resolved in the main process and rendered as readable Markdown:

````markdown
## Referenced file: `src/main/composer-ipc.ts`

```typescript
...bounded contents...
```
````

Folders render a bounded listing rather than recursively injecting every file.

## Resolution and security

The renderer never resolves paths. The main process must:

- resolve only against allowed Repository working paths;
- reject absolute paths, traversal, and symlink escapes;
- revalidate at submission time because autocomplete results can become stale;
- skip binary files and cap individual and aggregate content sizes;
- preserve unavailable references instead of silently substituting another path;
- use the stable Repository ID as the managed Session prefix, so duplicate Repository names cannot select another Repository's content.

## Suggested types

```ts
type SessionFile = Readonly<{
  path: string
  kind: 'file' | 'folder'
  name: string
}>

type SessionFileReference = Readonly<{
  path: string
  kind: 'file' | 'folder'
  availability: 'available' | 'unavailable'
}>

type SessionFileMention = Readonly<{
  file: SessionFileReference
  offset: number
}>
```

The Composer bridge should expose a scoped candidate query, rather than returning an entire repository index. Results should be bounded and ordered by path hierarchy, then exact path/name match, prefix match, and substring match.

## Implementation sequence

1. Add file reference domain and projection helpers, mirroring Skills.
2. Add main-process scoped candidate discovery and validated Markdown resolution.
3. Extend the Composer submission/transcript contract with optional file mentions.
4. Add `ComposerFileNode` and `@` autocomplete to the existing Lexical editor.
5. Add transcript and queued-follow-up rendering for unavailable references.
6. Add tests for parsing, path escape rejection, stale references, Markdown limits, and selection/serialization.

## Product decisions

- `@` means attach context, matching OpenCode, Claude Code, Cursor, and Cline conventions.
- File contents are injected as Markdown context; XML is not required.
- Folder tags initially provide bounded listings.
- Existing messages without file metadata continue to load unchanged.
