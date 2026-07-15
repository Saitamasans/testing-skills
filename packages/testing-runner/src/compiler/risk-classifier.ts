import type { ExecutionTarget, ManifestAction, RiskLevel } from "../types.js";

export interface RiskContext {
  target?: ExecutionTarget;
  environment_label?: string;
  data_sensitivity?: "normal" | "sensitive";
  shared_data?: boolean;
  high_privilege?: boolean;
  mixed_target?: boolean;
  effect?:
    | "business_write"
    | "asset_deduction"
    | "award_issuance"
    | "configuration_change"
    | "external_notification"
    | "irreversible";
}

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

const riskRank: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };

export function classifyRisk(action: ManifestAction, context: RiskContext = {}): RiskAssessment {
  const assessments: RiskAssessment[] = [declaredRisk(action)];

  if (isReadAction(action)) {
    assessments.push({ level: "R0", reasons: ["read-only action"] });
  } else {
    assessments.push({ level: "R1", reasons: ["reversible business write or UI mutation"] });
  }

  if (
    context.shared_data ||
    context.high_privilege ||
    context.mixed_target ||
    context.data_sensitivity === "sensitive" ||
    context.target?.kind === "database"
  ) {
    assessments.push({ level: "R2", reasons: ["shared, sensitive, high-privilege, mixed-target, or database scope"] });
  }

  if (isR3Effect(context.effect) || actionLooksIrreversible(action)) {
    assessments.push({ level: "R3", reasons: ["irreversible or externally material side effect"] });
  }

  return assessments.reduce((max, item) =>
    riskRank[item.level] > riskRank[max.level] ? item : max,
  );
}

function declaredRisk(action: ManifestAction): RiskAssessment {
  return { level: action.risk, reasons: [`declared risk ${action.risk}`] };
}

function isReadAction(action: ManifestAction): boolean {
  return (
    action.type === "api.assert" ||
    action.type === "api.extract" ||
    action.type === "db.select" ||
    action.type === "web.assert" ||
    action.type === "web.goto" ||
    action.type === "web.wait" ||
    (action.type === "api.request" && action.method === "GET")
  );
}

function isR3Effect(effect: RiskContext["effect"]): boolean {
  return effect === "asset_deduction" ||
    effect === "award_issuance" ||
    effect === "configuration_change" ||
    effect === "external_notification" ||
    effect === "irreversible";
}

function actionLooksIrreversible(action: ManifestAction): boolean {
  const text = JSON.stringify(action).toLowerCase();
  return /award|deduct|charge|config|notify|email|sms|irreversible/.test(text);
}
