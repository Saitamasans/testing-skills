# Runner 1.1.3 compatibility decision

The developing Runner differs from immutable tag `testing-runner-v1.1.2` in its package-first input path, discovery-bound action handling, per-case browser context lifecycle, and result projection. Those bytes and behaviors therefore use package and CLI identity 1.1.3; they must never be published or installed as 1.1.2.

| Runtime | Status | Runner | Compiler | Contract | Node | Playwright |
| --- | --- | --- | --- | --- | --- | --- |
| 1.0.2 | released, immutable | 1.1.2 | not bundled | not package-first | 22.23.1 | 1.61.1 |
| 1.0.3 | preparation | 1.1.3 | 1.0.0 | 1.0.0 | 22.23.1 | 1.61.1 |

Contract 1.0.0 remains the correct schema identity. Runner 1.1.3 adds validation, binding, execution, isolation, and result behavior around the existing fields; it does not remove or reinterpret a Contract 1.0.0 field. Existing valid Contract 1.0.0 packages therefore remain valid, so a Contract version bump would misrepresent a backward-compatible Runner change.

`packages/testing-runner/release/runner-1.1.3-release-lock.json` is preparation state only. Its artifact size and SHA-256 remain null until a later reproducible A/B build gate succeeds. No 1.1.3 tag, Release, or asset is created by this checkpoint. Runtime 1.0.2 and the published Runner 1.1.2 tag, tarball, size, and SHA-256 remain historical immutable inputs.
