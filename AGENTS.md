# Agent Guidelines

These guidelines apply to all changes in this repository.

- Use bun.
- Do not stage or commit changes unless the human explicitly asks. Leave changes unstaged so the human can review them manually.
- Use Conventional Commits for commit messages.

## Scope

- Make focused changes that address only the requested behavior.
- Pi Workspace is in active development. Do not add backwards-compatibility or data-migration support unless the human explicitly requests it.
- Do not add speculative concepts, states, abstractions, or supporting features before their requirements are known.
- Apply YAGNI and KISS. Apply DRY to repeated knowledge or behavior, not coincidentally similar code.
- Reuse existing code when it is a natural fit, but do not introduce an abstraction solely to remove small amounts of duplication.
- Ask the human before expanding scope or making an unsupported product or domain decision.

## Domain language and naming

- Follow domain-driven design and use the project's established domain language consistently.
- Use `type` for data structures. Use `interface` only for behavioral contracts implemented by functions or classes.
- Use the `Options` suffix for configuration data and the `Properties` suffix for UI component properties. Do not use the abbreviated `Props` suffix for locally defined types.
- Naming is part of the design. If a variable, function, module, or domain concept does not have a clear name, ask the human rather than guessing.
- Read the root domain glossary in `CONTEXT.md` before naming domain concepts. Update it only after terminology has been explicitly resolved.

## Code design

- Keep code formatted, readable, and intention-revealing.
- Use blank lines to separate logical blocks within functions and callbacks, such as setup, guards, transformations, side effects, and return or cleanup; keep tightly related statements together.
- Use an existing shared UI component whenever it fits the required behavior and appearance; do not recreate it locally.
- Use semantic theme tokens for component colors. Do not use direct palette colors in components, so additional themes can provide their own values.
- Use Lucide for interface icons. Keep icons in Lucide's default outline style; only fill an icon when the fill communicates an explicit state.
- Apply single responsibility and keep modules focused.
- Prefer simple composition and shared code over duplication when the shared concept is already understood.
- Do not over-abstract. Introduce a seam only when behavior genuinely varies or complexity is otherwise repeated across callers.

## Testing

- Use test-driven development for behavior changes where focused automated tests provide value.
- Each test should verify one behavior and should not combine unrelated assertions.
- Test our code, not third-party library behavior.
- Test functionality, such as interactions and state transitions, plus complex layout logic where automated coverage provides value. Do not test static presentation details such as whether an element is displayed in a particular position, which utility classes it uses, or its exact size.
- Use tests deliberately; do not pursue 100% coverage as a goal.
- Keep test setup proportionate to the behavior under test.

## Validation

- Format changed files.
- Run the relevant focused tests, type checks, and lint checks before finishing.
- Report validation failures clearly, including failures unrelated to the current change.
