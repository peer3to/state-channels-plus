## Repository Workflow

- Use `yarn` commands in this repository. Do not use `pnpm verify`.
- For post-edit validation, run the narrowest relevant test first when available.
- Run `yarn tsc --noEmit -p tsconfig.json` for TypeScript typechecking.
- Run `yarn compile` for compile-level validation when changes affect the build or exported package surface.

## Conventions

- Never log with `console.*`. Use the internal logger (the one returned during `p2pSetup`); its output is collected and shipped for analysis, so `console.*` calls are invisible to that pipeline. This applies to main-thread code too. If a module has no logger in scope, thread one through its options/params rather than reaching for `console.*`.
