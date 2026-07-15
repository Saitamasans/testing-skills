import type { CopyableExamples, ReadinessAssessment } from "./readiness.js";

function fencedJson(value: unknown): string {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

function appendExample(lines: string[], label: keyof CopyableExamples, value: unknown): void {
  if (value === undefined) return;
  lines.push(`\n## ${label}`);
  lines.push(fencedJson(value));
}

export function renderPreparationGuide(assessment: ReadinessAssessment): string {
  const lines: string[] = [
    `# Preparation readiness: ${assessment.level}`,
    `Runner allowed: ${assessment.runner_allowed ? "yes" : "no"}`,
  ];

  if (assessment.blocking.length > 0) {
    lines.push("\n## Blocking preparation");
    for (const item of assessment.blocking) lines.push(`- ${item}`);
  }

  if (assessment.optional.length > 0) {
    lines.push("\n## Optional preparation");
    for (const item of assessment.optional) lines.push(`- ${item}`);
  }

  lines.push("\n## Available");
  for (const item of assessment.available) lines.push(`- ${item}`);

  lines.push("\n## Copyable JSON examples");
  appendExample(lines, "targets", assessment.copyable_examples.targets);
  appendExample(lines, "credentials", assessment.copyable_examples.credentials);
  appendExample(lines, "data", assessment.copyable_examples.data);
  appendExample(lines, "cleanup", assessment.copyable_examples.cleanup);
  appendExample(lines, "runtime", assessment.copyable_examples.runtime);

  lines.push("\n## Runtime probe");
  if (assessment.runtime_probe.runner) {
    const runner = assessment.runtime_probe.runner;
    lines.push(`- runner: ${runner.package} ${runner.version}; compatible=${runner.compatible}; source=${runner.source}; impact=${runner.impact}`);
  }
  if (assessment.runtime_probe.node) {
    const node = assessment.runtime_probe.node;
    lines.push(`- node: ${node.version}; compatible=${node.compatible}; required=${node.required_version ?? "n/a"}; source=${node.source}; impact=${node.impact}`);
  }
  for (const browser of assessment.runtime_probe.browsers) {
    lines.push(`- browser: ${browser.package} ${browser.version}; installed=${browser.installed}; source=${browser.source}; impact=${browser.impact}`);
  }
  for (const target of assessment.runtime_probe.target_connectivity) {
    lines.push(`- target: ${target.target_alias}; reachable=${target.reachable}; impact=${target.impact}`);
  }
  for (const driver of assessment.runtime_probe.optional_db_drivers) {
    lines.push(`- db driver: ${driver.package} ${driver.version}; installed=${driver.installed}; source=${driver.source}; impact=${driver.impact}`);
  }

  if (assessment.runtime_probe.missing_software.length > 0) {
    lines.push("\n## Runtime probe missing software");
    for (const item of assessment.runtime_probe.missing_software) {
      lines.push(`- ${item.package} (${item.source}, ${item.version}): ${item.impact}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
