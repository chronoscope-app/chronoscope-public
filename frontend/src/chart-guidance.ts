import type { ChartConfig, ChartReport } from "./charts-panel";
import {
  numericCount,
  numericRoleAllowed,
  roleFields,
  type FieldRoles,
} from "./field-roles";
import type { EngineContracts } from "./contracts";

export type ChartTask =
  | "compare"
  | "time"
  | "distribution"
  | "relationship"
  | "spread"
  | "patterns"
  | "composition"
  | "periods";
export const chartTasks: { id: ChartTask; title: string; hint: string }[] = [
  { id: "compare", title: "Compare groups", hint: "Count Events by entity" },
  {
    id: "time",
    title: "Change over time",
    hint: "Count Events in UTC intervals",
  },
  {
    id: "distribution",
    title: "Distribution",
    hint: "See the spread of a measurement",
  },
  {
    id: "relationship",
    title: "Relationship",
    hint: "Compare two numeric measurements",
  },
  {
    id: "spread",
    title: "Compare spread",
    hint: "Compare measurement variability and outliers across groups",
  },
  {
    id: "patterns",
    title: "Repeating patterns",
    hint: "See recorded Events by UTC weekday and hour",
  },
  {
    id: "composition",
    title: "Composition over time",
    hint: "See how groups contribute to Event counts over time",
  },
  {
    id: "periods",
    title: "Compare periods",
    hint: "Compare two UTC windows, with exact changes and percentages",
  },
];
export const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const hourLabel = (hour: number) =>
  `${String(hour).padStart(2, "0")}:00`;
export const periodLabel = (series: unknown) =>
  Number(series) === 0 ? "Period A" : "Period B";
export function activeChartTask(c: ChartConfig): ChartTask {
  if (c.kind === "heatmap") return "patterns";
  if (c.kind === "period") return "periods";
  if (c.kind === "boxplot") return "spread";
  if (c.kind === "histogram") return "distribution";
  if (c.kind === "scatter") return "relationship";
  if (c.x_axis === "time") return c.stacked && c.group ? "composition" : "time";
  return "compare";
}
const names: Record<string, string> = {
  entity: "Entity",
  category: "Category",
  time: "Time",
  end: "End time",
  value: "Value",
  lat: "Latitude (°)",
  lon: "Longitude (°)",
  year_utc: "UTC year",
};
export const fieldLabel = (value: string) =>
  names[value] ||
  value.replace(/^attribute:/, "Imported · ").replaceAll("_", " ");
export const operationLabel = (op: string) =>
  ({
    count: "Event count",
    mean: "Average",
    sum: "Sum",
    min: "Minimum",
    max: "Maximum",
  })[op] || op;
export const scopeLabel = (scope: string) =>
  ({
    all: "All Events",
    visible: "Filtered Events",
    selected: "Selected Events",
  })[scope] || scope;
export const intervalLabel = (bucket: string) =>
  ({
    none: "Individual timestamps",
    millisecond: "Per millisecond",
    second: "Per second",
    minute: "Per minute",
    hour: "Hourly",
    day: "Daily",
    week: "Weekly",
    month: "Monthly",
    year: "Yearly",
  })[bucket] || bucket;
export function measurementLabel(field: string, report?: ChartReport) {
  const unit = field === "value" ? report?.value_metadata?.unit : null;
  return fieldLabel(field) + (unit ? ` (${unit})` : "");
}
export function axisLabel(
  c: ChartConfig,
  axis: "x" | "y" | "y2",
  report?: ChartReport,
) {
  const custom = c[`${axis}_label`]?.trim();
  if (custom) return custom;
  if (c.kind === "heatmap")
    return axis === "x" ? "Hour (UTC)" : "Weekday (UTC)";
  if (axis === "x")
    return measurementLabel(c.kind === "histogram" ? c.y : c.x, report);
  if (
    c.kind === "histogram" ||
    (c.aggregate === "count" && !["scatter", "boxplot"].includes(c.kind))
  )
    return "Event count";
  const label = measurementLabel(axis === "y2" ? c.y2 : c.y, report);
  return ["scatter", "boxplot"].includes(c.kind)
    ? label
    : `${operationLabel(c.aggregate)} ${label}`;
}
export function chartTitle(
  c: ChartConfig,
  presets: { name: string; config: ChartConfig }[],
  report?: ChartReport,
) {
  if (c.title?.trim()) return c.title.trim();
  // Object key order is not a chart property; restored Rust configs sort keys.
  const same = (p: ChartConfig) =>
    Object.keys(c).every(
      (k) =>
        JSON.stringify(p[k as keyof ChartConfig]) ===
        JSON.stringify(c[k as keyof ChartConfig]),
    );
  const preset = presets.find((p) => same(p.config));
  if (preset) return preset.name;
  if (c.kind === "heatmap")
    return `${c.aggregate === "count" ? "Event count" : operationLabel(c.aggregate) + " " + measurementLabel(c.y, report)} by weekday and hour`;
  if (c.kind === "period")
    return `${axisLabel(c, "y", report)} by ${fieldLabel(c.x)} · Period A vs B`;
  if (c.stacked && c.group && c.x_axis === "time")
    return `${axisLabel(c, "y", report)} over time by ${fieldLabel(c.group)}`;
  if (c.kind === "histogram")
    return `${measurementLabel(c.y, report)} distribution`;
  if (c.kind === "boxplot")
    return `${measurementLabel(c.y, report)} spread by ${fieldLabel(c.x)}`;
  if (c.kind === "scatter")
    return `${measurementLabel(c.y, report)} vs ${measurementLabel(c.x, report)}`;
  return `${c.x_axis === "time" ? intervalLabel(c.time_bucket) + " " : ""}${axisLabel(c, "y", report)} ${c.x_axis === "time" ? "over time" : "by " + fieldLabel(c.x)}`;
}
export const timeBuckets = [
  "millisecond",
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;
export function suggestedTimeBucket(
  bounds: [number, number],
  series = 1,
  budget = 1000,
): ChartConfig["time_bucket"] {
  const span = Math.max(0, bounds[1] - bounds[0]);
  // A display estimate, never a source-data aggregation or statistic. The
  // actual chosen interval stays explicit and editable in the controls.
  const seconds = [0.001, 1, 60, 3600, 86400, 604800, 2419200, 31536000];
  return (
    timeBuckets.find(
      (_, i) =>
        (Math.ceil(span / seconds[i]) + 1) * Math.max(1, series) <= budget,
    ) || "year"
  );
}
export function measurementFields(
  schema?: EngineContracts["dataset_schema"]["result"],
  roles: FieldRoles = schema?.field_roles || {},
) {
  if (!schema) return [];
  const excluded =
    /(^|[\s_:.-])(id|identifier|index|row|source|time|timestamp|date|year|month|day|hour|min|minute|sec|second|lat|latitude|lon|long|longitude|deployment)([\s_:.-]|$)/i;
  const fields = schema.attributes
    .filter(
      (name) =>
        Number(schema.attribute_types?.[name]?.numeric_count) > 0 &&
        !excluded.test(name) &&
        (name !== "value" || !Number(schema.numeric_counts?.value)),
    )
    .map((name) => `attribute:${name}`);
  // Canonical counts are exact schema evidence, independent of the import mapping.
  if (Number(schema.numeric_counts?.value) > 0) fields.unshift("value");
  const explicit = roleFields(schema).filter(
    (field) =>
      roles[field] === "measurement" &&
      numericRoleAllowed(field) &&
      numericCount(schema, field) > 0,
  );
  return [
    ...new Set([...explicit, ...fields.filter((field) => !roles[field])]),
  ];
}
export function categoryField(
  roles: FieldRoles = {},
  schema?: EngineContracts["dataset_schema"]["result"],
) {
  const available = schema ? new Set(roleFields(schema)) : undefined;
  return (
    Object.keys(roles)
      .sort()
      .find(
        (field) =>
          roles[field] === "category" && (!available || available.has(field)),
      ) ||
    ["entity", "category", "source"].find((field) => roles[field] !== "ignore")
  );
}
export function relationshipFields(fields: string[], roles: FieldRoles = {}) {
  const explicit = fields.filter((field) => roles[field] === "measurement");
  const rest = fields.filter((field) => !explicit.includes(field));
  if (explicit.length) return [...explicit, ...rest];
  const imported = fields.filter((field) => field !== "value");
  return imported.length >= 2 ? imported : fields;
}
