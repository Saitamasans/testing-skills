# CI example for testing-runner

This example shows the intended CI shape without real domains or credentials.

1. Generate and review the manifest locally:

   ```powershell
   npx @saitamasans/testing-runner@1.0.0 plan --input report.json --profile execution-profile.json --output-dir .testing-run
   npx @saitamasans/testing-runner@1.0.0 approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at <ISO_EXPIRES_AT> --confirmed-by reviewer-name
   ```
   Use a short-lived `<ISO_EXPIRES_AT>` inside the current execution window; do not create long-lived approvals.

2. Commit or upload the reviewed `run-manifest.json` and `approval.json` through your normal protected workflow.

3. In CI, run only the locked manifest and approval. CI mode accepts R0/R1 actions only, reads credentials from CI secrets, and uploads the whole run directory even when the business verdict is nonzero.
