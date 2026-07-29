# Flowkit Demo

Independent leave-approval reference consumer for the five public Flowkit packages. It does not
import FAAN code or sibling package source.

## Quickstart

```bash
bun install
bun run --cwd packages/flowkit-demo typecheck
bun run --cwd packages/flowkit-demo test
bun run --cwd packages/flowkit-demo dev:api
curl http://localhost:3011/health/ready
```

The demo UI is served at `http://localhost:3011/`. It is a Flowkit reference console: sign in as
an employee, create and submit a multi-day request, switch to its assigned manager to claim and
approve or reject it, then inspect the immutable activity trail and durable delivery evidence.
The console speaks only in Flowkit concepts; its runtime implementation is an internal adapter.
`POST /auth/login` establishes a signed, development-only session for a canonical local principal.
Seeded identities are employee-1, manager-1, manager-2, hr-1, and auditor-1. They are local/test
fixtures only.

## Processes and scenarios

```bash
bun run --cwd packages/flowkit-demo dev:worker
bun run --cwd packages/flowkit-demo dev:notify
bun run --cwd packages/flowkit-demo scenario -- short-auto-approved
```

The scenario runner exercises `@flowkit/core` transitions, `@flowkit/temporal` snapshots,
`@flowkit/tasks` projections/claims, `@flowkit/notify` fan-out/dedupe, and `@flowkit/auth`
canonical principals.

## PostgreSQL and Docker

Compose uses only `flowkit_demo` resources and pinned images. The checked-in SQL is disposable.
The migrator refuses other database names and refuses to apply SQL without explicit approval:

```bash
FLOWKIT_DEMO_MIGRATION_APPROVED=true bun run --cwd packages/flowkit-demo db:migrate
```

Do not run that command without approval. `stack:reset` only prints the guarded reset command.

If a default host port is occupied, override it without changing container-to-container addresses:

```bash
FLOWKIT_DEMO_API_PORT=3012 FLOWKIT_DEMO_MAILPIT_HTTP_PORT=8026 FLOWKIT_DEMO_MAILPIT_SMTP_PORT=1026 \
FLOWKIT_DEMO_POSTGRES_PORT=5442 FLOWKIT_DEMO_TEMPORAL_PORT=7234 \
bun run --cwd packages/flowkit-demo stack:up
```

## Browser reference proof

The Playwright suite uses an already-running disposable Compose stack. It never applies a
migration, seeds a database, or starts Docker itself. After explicit approval to run the disposable
migration/seed services and after the stack is healthy, run:

```bash
bun run --cwd packages/flowkit-demo test:browser
```

It proves the browser-visible employee → manager claim → approve/reject journey, final flow stage
and activity timeline, an employee's durable inbox notification, current Flowkit runtime/delivery
heartbeats, and an approval email visible through Mailpit. For non-default host ports, set
`FLOWKIT_DEMO_URL` (for example `http://localhost:3012`) and
`FLOWKIT_DEMO_MAILPIT_URL` (for example `http://localhost:8026`) before running the suite.

## Package boundary

`package-contracts.json` and `test/package-contracts.preflight.test.ts` enumerate the public
exports consumed by the demo. `test/package-boundary.test.ts` rejects FAAN and sibling-source
imports. The live SLA is committed as `PT10S` in the definition and is never environment-driven.
