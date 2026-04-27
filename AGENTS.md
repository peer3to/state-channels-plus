## Repository Workflow

- Use `yarn` commands in this repository. Do not use `pnpm verify`.
- For post-edit validation, run the narrowest relevant test first when available.
- Run `yarn tsc --noEmit -p tsconfig.json` for TypeScript typechecking.
- Run `yarn compile` for compile-level validation when changes affect the build or exported package surface.
