#!/usr/bin/env sh
set -eu
for skill in \
  single-api-test-full \
  single-api-test-concise \
  multi-api-flow-test \
  requirement-test-workbench \
  production-verification-test \
  test-case-quality-audit \
  requirement-clarification-test
do
  npx skills add Saitamasans/testing-skills --path "skills/$skill"
done
