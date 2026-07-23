#!/usr/bin/env sh
set -eu
for skill in \
  single-api-test-full \
  single-api-test-concise \
  multi-api-flow-test \
  requirement-test-workbench \
  enhanced-graybox-test-case-generation \
  production-verification-test \
  test-case-quality-audit \
  requirement-clarification-test \
  web-api-test-execution-evidence \
  test-case-execution-compiler
do
  npx skills add "Saitamasans/testing-skills@$skill" -g -y
done
