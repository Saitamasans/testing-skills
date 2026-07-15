# CI example for testing-runner

This example shows the intended CI shape without real domains or credentials.

1. Generate and review the manifest locally:

   ```powershell
   npx @saitamasans/testing-runner@1.0.0 plan --input report.json --profile execution-profile.json --output-dir .testing-run
   npx @saitamasans/testing-runner@1.0.0 approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at 2999-01-01T00:00:00.000Z --confirmed-by reviewer-name
   ```

2. Commit or upload the reviewed `run-manifest.json` and `approval.json` through your normal protected workflow.

3. In CI, run only the locked manifest and approval. CI mode accepts R0/R1 actions only, reads credentials from CI secrets, and uploads the whole run directory even when the business verdict is nonzero.
