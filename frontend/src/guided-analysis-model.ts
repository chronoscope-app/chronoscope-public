import type { EngineContracts } from "./contracts";

export const analysisTasks = [
  {
    id: "profile",
    title: "Profile data",
    description:
      "Check completeness, missing values and descriptive statistics.",
  },
  {
    id: "duplicates",
    title: "Find duplicates",
    description:
      "Find records with matching values in the fields you choose. Nothing is deleted.",
  },
  {
    id: "outliers",
    title: "Find outliers",
    description: "Review unusual measurements and select their source Events.",
  },
  {
    id: "trajectories",
    title: "Summarize trajectories",
    description:
      "Calculate recorded track length, elapsed time and maximum segment speed per entity.",
  },
] as const;
export type AnalysisTask = (typeof analysisTasks)[number]["id"];
export interface AnalysisDraft {
  task: AnalysisTask;
  scope: "all" | "visible" | "selected";
  fields: string[];
  method: "iqr" | "zscore";
  threshold: number;
  source: string | null;
}
export function analysisPlan(
  draft: AnalysisDraft,
): EngineContracts["analytics_run"]["args"]["plan"] {
  const fields = [...new Set(draft.fields)];
  const max =
    draft.task === "profile" ? 16 : draft.task === "duplicates" ? 8 : 1;
  if (draft.task !== "trajectories" && (!fields.length || fields.length > max))
    throw Error(`Choose ${max === 1 ? "one measurement" : `1–${max} fields`}.`);
  if (fields.some((f) => !f.length || f.length > 256))
    throw Error("A field name is not supported by this analysis.");
  if (
    draft.task === "outliers" &&
    (!Number.isFinite(draft.threshold) ||
      draft.threshold <= 0 ||
      draft.threshold > 20)
  )
    throw Error("Outlier threshold must be greater than zero and at most 20.");
  const parameters =
    draft.task === "trajectories"
      ? {}
      : draft.task === "outliers"
        ? { field: fields[0], method: draft.method, threshold: draft.threshold }
        : { fields };
  return {
    capability: draft.task,
    scope: draft.scope,
    parameters,
    output_limit: 10000,
  };
}
