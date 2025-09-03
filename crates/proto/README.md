Crates/proto — Schema registry & rules
=====================================

Overview
--------
This crate holds the authoritative Cap'n Proto schemas for the project and the small policy for schema evolution. The primary schema file is:

  - schema/message.capnp

It defines the canonical on-wire Envelope used across RPC and PUB/SUB.

Versioning and schema policy
----------------------------
Follow these rules to keep forward/backward compatibility:

1. Never reuse field IDs.
   - Once a numeric field ID is used (e.g., `@3`), never give that number to another field.
2. Only append new fields.
   - Add new fields at fresh field IDs (incremental numbers).
3. Avoid removing fields. If a field must be removed, mark it as deprecated in the README and leave the ID unused (document it in the change).
4. Prefer optional fields to breaking changes.
5. Use unions (as Envelope does) for extensibility of message kinds.
6. Keep messages small and flat where possible (avoid deep nesting).
7. Reserve contiguous ranges if you expect many future fields (document ranges in the README next to the schema).

ID and ordering
---------------
- Message `id`: use a 16-byte ULID (binary) for canonical idempotency/dedupe across the system. Store as `Data` in Cap'n Proto and as a 26-char Crockford base32 string for human-friendly logs.
- `seq`: server-assigned monotonic u64 per-room (persisted in storage) for easy gap detection and backfill queries.
- `serverTs`: server ingest timestamp (ms since epoch). Clients should treat local clocks as cosmetic.

Build & regenerate instructions
-------------------------------
The build script (build.rs) uses `capnpc` to compile the .capnp schema to Rust sources in OUT_DIR.

Requirements:
- Rust toolchain (stable)
- Cap'n Proto compiler (capnp)
  - macOS: `brew install capnp`
  - Linux: `apt install capnproto` (or build from source)
  - Windows: use Chocolatey `choco install capnproto` or download from https://capnproto.org/install.html

To generate Rust sources manually (from repo root):
- cargo build -p proto
  This runs the capnpc compile step via the build script.

If you cannot install the `capnp` binary on your machine/CI:
- Option A (CI): provide a prebuilt capnp compiler binary to PATH.
- Option B (dev): avoid compiling proto in CI and instead vendor pre-generated Rust files into the repo (not ideal for long-term).
- Option C: Run schema generation inside a container that has capnp installed.

Schema evolution workflow
-------------------------
- When changing the schema:
  1. Add new fields at new IDs; update the schema comment block with a short changelog.
  2. Run `cargo build -p proto` and commit the generated Rust sources if you choose to vendor them.
  3. Update any consuming crates with conversions / defaulting logic for new optional fields.

Files & responsibilities
------------------------
- message.capnp — canonical schema used on the wire.
- build.rs — compiles schema into Rust sources at build time.
- src/lib.rs — includes generated Rust code from OUT_DIR.

Notes
-----
- Keep the schema small and stable. The Cap'n Proto binary format is compact and fast; prefer it for inter-node RPC and PUB/SUB messages on hot paths.
- Document any reserved ranges or deprecated field IDs in this README with timestamps and rationale.

Example: quick regenerate
-------------------------
1. Ensure `capnp` compiler is installed and available on PATH.
2. From repo root:
   cargo build -p proto

If the build fails with a capnp-related error, confirm the capnp binary is installed and on PATH. On Windows, PowerShell may need to be restarted after installing Cap'n Proto so PATH updates are picked up.
