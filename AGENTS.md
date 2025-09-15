# Repository Guidelines

## Project Structure & Module Organization
The workspace is split by apps: Qwik web front-end in `apps/web`, Axum gateway in `apps/gateway`, Lynx shell in `apps/lynx`, Tauri desktop in `apps/desktop`, and the mobile client in `apps/mobile`. Shared Rust crates live under `crates/*`, and TypeScript utilities land in `packages/shared`. Global design tokens stay in `tokens/`, and repo-wide scripts sit in `scripts/`. Playwright specs reside in `apps/web/tests`, while Rust unit and integration tests stay beside the code they exercise.

## Build, Test, and Development Commands
- `cd apps/web && bunx tsc --noEmit src/path.tsx` — type-check a focused Qwik file.
- `cd apps/web && bunx eslint --fix src/path.tsx` — lint and autofix web code.
- `bunx prettier --write path/to/file` — format TypeScript, JavaScript, CSS, or Markdown.
- `cd apps/web && bunx playwright test tests/auth.spec.ts` — run a single E2E spec.
- `cargo check -p gateway` / `cargo test -p gateway` — ensure the Axum service builds and passes tests.
- `cargo fmt -- path/to/file.rs` — format targeted Rust files.
Reserve `bun run dev:all` or `bun run build:ssg` for explicit full-run requests only.

## Coding Style & Naming Conventions
Follow Qwik loader/action patterns and reuse helpers from `apps/web/src/lib/http.ts` and friends. Use Tailwind v4 + DaisyUI v5 utilities; never hard-code theme values or colors. Components use PascalCase, routes use kebab-case folder names, and Rust modules stick to snake_case. Keep diffs small, colocated, and comment only when intent is non-obvious.

## Testing Guidelines
Run relevant Playwright specs for any touched UI flow, and execute `cd apps/web && bun run build.types` when type surfaces shift. Backend work must pass `cargo clippy -p gateway -- -D warnings` plus crate-level tests. Name new Playwright specs `*.spec.ts` and embed Rust tests within `mod tests` blocks alongside production code.

## Commit & Pull Request Guidelines
Adopt Conventional Commit prefixes such as `feat(scope): detail`, `fix(scope): detail`, or `chore(scope): detail`. Each PR should list the verification commands run, link associated issues, and attach UI screenshots when visuals change. Keep PRs tight in scope and ensure lint, type, and test jobs are green before requesting review.

## Agent & Security Notes
Use Bun for all JS/TS tooling and avoid introducing npm, pnpm, or yarn. Normalize SSR gateway calls to `http://127.0.0.1:7000` to dodge IPv6 quirks. Ask before running long-lived processes, editing Docker or Traefik configs, or touching credentials. Reuse existing CSRF, logging, and API helpers instead of adding new HTTP clients.
