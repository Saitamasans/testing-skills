$ErrorActionPreference = "Stop"
$skills = @(
  "single-api-test-full",
  "single-api-test-concise",
  "multi-api-flow-test",
  "requirement-test-workbench",
  "production-verification-test",
  "test-case-quality-audit",
  "requirement-clarification-test",
  "web-api-test-execution-evidence"
)
foreach ($skill in $skills) {
  & npx skills add Saitamasans/testing-skills --path "skills/$skill"
  if ($LASTEXITCODE -ne 0) { throw "安装失败：$skill" }
}
