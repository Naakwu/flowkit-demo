# Flowkit Demo

Independent leave-approval reference consumer for the six public FlowKit packages. The repository
is an application monorepo: transport, browser, workflow worker, delivery worker, replaceable
domain vocabulary, persistence, and starter-owned UI each have an explicit boundary. It does not
import FAAN code or sibling package source.

## Quickstart

```bash
bun install
bun run typecheck
bun run test
bun run dev:api
curl http://localhost:3011/health/ready
```

The Vite UI runs at `http://localhost:3012/` and proxies its same-origin API routes to the Nest API
at `http://localhost:3011/`. It is a neutral FlowKit workspace: sign in through BetterAuth, select
an organization from the authenticated membership set, create and submit a multi-day request,
sign in as its assigned manager to claim and approve or reject it, then inspect the activity trail
and durable delivery evidence. Organization scope and application role always come from the
server-validated session membership; request bodies cannot select an organization.

For frontend-only development, start the existing API with the Vite public origin, then run:

```bash
BETTER_AUTH_URL=http://localhost:3012 bun run dev:api
bun run --cwd apps/web dev
```

The starter UI is organized by domain feature under `apps/web/src/features`; reusable neutral
tokens and accessible primitives live in `packages/ui`. The browser client sends same-origin
credentials and a new idempotency key with every create, claim, and decision mutation.

## Processes and scenarios

```bash
bun run dev:worker
bun run dev:notify
bun run scenario -- short-auto-approved
```

The scenario runner exercises `@naakwu/flowkit-core` transitions, `@naakwu/flowkit-temporal` snapshots,
`@naakwu/flowkit-tasks` projections/claims, `@naakwu/flowkit-notify` fan-out/dedupe, and `@naakwu/flowkit-auth`
canonical principals.

## PostgreSQL and Docker

Compose uses only `flowkit_demo` resources and pinned images. The checked-in SQL is disposable.
The migrator refuses other database names and refuses to apply SQL without explicit approval:

```bash
FLOWKIT_DEMO_MIGRATION_APPROVED=true bun run db:migrate
```

Do not run that command without approval. `stack:reset` only prints the guarded reset command.

If a default host port is occupied, override it without changing container-to-container addresses:

```bash
FLOWKIT_DEMO_API_PORT=3012 FLOWKIT_DEMO_MAILPIT_HTTP_PORT=8026 FLOWKIT_DEMO_MAILPIT_SMTP_PORT=1026 \
FLOWKIT_DEMO_MAILPIT_URL=http://localhost:8026 \
FLOWKIT_DEMO_POSTGRES_PORT=5442 FLOWKIT_DEMO_TEMPORAL_PORT=7234 \
bun run stack:up
```

## Browser reference proof

The Playwright suite uses an already-running disposable Compose stack. It never applies a
migration, seeds a database, or starts Docker itself. After explicit approval to run the disposable
migration/seed services and after the stack is healthy, run:

```bash
bun run test:browser
```

It proves real BetterAuth email/password sessions, explicit organization selection, the
browser-visible employee → manager claim → approve/reject journey, final flow stage and activity
timeline, an employee's durable inbox notification, visible request failures, and an approval
email visible through Mailpit. For non-default host ports, set
`FLOWKIT_DEMO_URL` (the default is `http://localhost:3012`) and
`FLOWKIT_DEMO_MAILPIT_URL` (for example `http://localhost:8026`) before running the suite.

Task 11 compiled and discovered all four Playwright scenarios without starting a stack. Their live
execution remains intentionally gated until an explicitly approved disposable migration and seed
run is available. Every queue interaction is scoped to the request its spec creates, so the proof
tolerates work left by earlier runs.

The console polls a flow while Flowkit's rule advances it through `policy_evaluation` and
`fulfillment`, because no operator action leaves those stages.

### Durable database tests

`bun test test` skips the durable tier by default. It needs a separate migrated database and,
for the specs that drive a real flow, a worker bound to that same database:

```bash
FLOWKIT_DEMO_DURABLE_TESTS=true \
DATABASE_URL=postgresql://flowkit_demo:flowkit_demo@localhost:5441/flowkit_demo_test \
bun test test/leave-flow-operation-scope.test.ts test/postgres-task-store.test.ts
```

The store, outbox, and operation-scope specs pass this way. Four specs that expect a live worker
(`scenario-runner`, `workflow.resilience`, `notifications.integration`, `durable-leave-service`)
still time out, because the Compose worker is bound to `flowkit_demo` rather than the test
database; running them needs a worker started against `flowkit_demo_test`.

## Package boundary

`package-contracts.json` and `test/package-contracts.preflight.test.ts` enumerate the public
exports consumed by the demo. `test/package-boundary.test.ts` rejects FAAN and sibling-source
imports. The live SLA is committed as `PT10S` in the definition and is never environment-driven.
