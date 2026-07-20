# Test Case Execution Compiler Design

## Scope

Add `test-case-execution-compiler` as the ninth Skill. It converts existing Web UI Excel cases into one reproducible Execution Package without modifying source cases, opening a browser, or inventing coverage. Refactor `web-api-test-execution-evidence` so READY packages are its only default formal input; raw Excel returns `execution_contract_required`.

## Architecture

`packages/testing-contract-compiler` is an independent TypeScript workspace using Node.js 22, Commander, ExcelJS, Ajv, Node crypto, and a pinned ZIP library. Deterministic modules own Excel parsing and mapping, schema validation, hashes, dependency and resource checks, READY decisions, ZIP construction, validation, and stale detection. The Skill owns natural-language interpretation and submits structured contract drafts to the compiler. It never imports Playwright.

The ZIP contains `source/`, `execution-contract.json`, `execution-readiness.md`, `unresolved-items.xlsx`, `source-mapping.json`, and `package-manifest.json`. Compilation stages only in the OS temporary directory, cleans on success and failure, and exposes only `<source>.execution-package.zip`. Secrets are represented by environment-variable names and scanned before packaging.

The eighth Skill validates package safety, integrity, source identity, readiness, and Contract 1.0.0 before loading actions. Its environment-binding layer retains read-only discovery, semantic locator binding, required transition discovery, final manifest assembly, approval, Runner execution, and evidence reporting. Missing actions return `contract_incomplete`; semantic compilation is logged as skipped. Case isolation creates and closes one BrowserContext per `isolation_scope=case`; only explicit `flow_group` contracts may share a context.

## Build And Delivery

The manifest becomes the source of truth for any positive number of uniquely named Skills. Generated packages copy compiler resources using the existing execution-Skill resource pattern. Runtime 1.0.3 contains portable Node 22.23.1, compiler 1.0.0, Contract 1.0.0, unchanged Runner 1.1.2, Playwright 1.61.1, and Chromium 1228. Runtime 1.0.2 assets and tags remain immutable.

Delivery is gated in order: compiler and runner tests, complete repository regression, generated-Skill validation, secret scan, the three-case live workstation flow through both Skills, core PR CI and merge, a separate installer-progress PR and merge, then reproducible Runtime 1.0.3 A/B build and immutable release. Any failed gate blocks merge or release.

## Error And Evidence Contract

NOT_READY packages remain single ZIP outputs and carry unresolved items. The eighth Skill refuses NOT_READY, unsafe, stale, inconsistent, or schema-invalid packages before browser work. All required phase durations are measured, not fabricated. Live evidence must prove three source and execution cases, three distinct successfully closed contexts, LOGIN-MINI-002 success, LOGIN-MINI-003 anonymous start, no logout action, consistent Excel/HTML/JSON, and PNG/Trace/JSONL presence.

