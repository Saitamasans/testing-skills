# Runner 1.1.3 Multi-target Discovery Design

## Scope

Extend the existing package-first `discover-plan` flow so one READY Execution Package may require multiple legitimate browser target states. The compiler contract, live-smoke fixture, case order, effects, isolation scopes, and Runner version remain unchanged. No manifest or receipt is hand-authored by the Runner, and final planning remains fail-closed.

## Discovery task model

The Runner derives a deterministic `discovery_tasks` array from contract cases that declare `effects.browser_state.target_state`. Each task records `discovery_task_id`, representative `source_case_id`, all deduplicated `source_case_ids`, `target_state`, `transition_actions_sha256`, `package_sha256`, normalized `origin`, requested URL, `isolation_scope`, and `required_auth_profile`.

The deduplication key contains target state, transition-action hash, origin, isolation scope, and auth-profile identity. Identical transition/state bindings can share one task; success and error target states can never share a task. Contract order determines task order and the representative source case, so output is deterministic.

## Execution and compatibility

`discover-plan` accepts repeated discovery approval paths. The existing single approval plus `--transition-case-id` form remains valid for a package with one task. For multiple tasks, all task approvals are required in deterministic task order; the command returns and persists the complete `discovery_tasks` array.

One Browser is launched for the command. Every discovery task creates a fresh BrowserContext and Page, resolves only referenced runtime credentials, executes its approved R0/R1 transition actions, samples the target page, issues one receipt, and closes that Context in `finally`. Context objects are never reused across tasks.

If a task fails, the error identifies its task ID and representative case ID. No receipt is created for the failed task, the case remains in the contract, and final manifest assembly does not run.

## Receipt and final-manifest gate

Each receipt adds explicit `discovery_task_id`, `source_case_id`, and task `source_case_ids` bindings while retaining the current run nonce, package SHA, origin/request/final URL, target state, transition-action SHA, page fingerprints, Runner/Runtime versions, approval SHA, and active-session MAC.

Receipt verification reconstructs the same deterministic tasks from package plus profile. It requires exactly one active-session receipt and matching approval per required task. Missing, forged, reordered, cross-package, cross-origin, cross-run, action-mismatched, or fingerprint-mismatched evidence rejects final manifest generation.

## Secret-scan classification

Strict secrets—passwords, wrong passwords, tokens, cookies, and storage state—remain zero-tolerance exact matches. Username matches are reported without the value and include artifact path, logical field, and provenance. A username match in a credential-bearing field or runtime input/output is a leak; a low-entropy match in independently generated public metadata, a domain, project/package name, locator, or page label is a documented natural collision rather than an automatic leak. Unknown provenance remains fail-closed.

## Test strategy

Tests cover two target states producing two tasks and two Contexts, deterministic deduplication, non-merging of success/error states, full receipt quorum, precise task failure, receipt binding attacks, and the unchanged single-target call. Separate secret-scan tests cover strict-secret zero tolerance, username credential-field leakage, natural collisions, provenance recording, and non-disclosure of the username value.
