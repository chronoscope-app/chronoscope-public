import { displayTime as time, displayDate, displayClock } from "./types";
import {
  axisLabel,
  measurementLabel,
  weekdays,
  hourLabel,
  periodLabel,
  operationLabel,
} from "./chart-guidance";
import { TOOLTIP_DELAY_MS } from "./tooltips";
import * as echarts from "echarts/core";
import {
  BarChart,
  LineChart,
  ScatterChart,
  BoxplotChart,
  HeatmapChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  ToolboxComponent,
  BrushComponent,
  AriaComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { entityColor } from "./types";
import {
  fieldLabel,
  chartValue,
  type ChartConfig,
  type ChartMark,
  type ChartReport,
} from "./charts-panel";
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  BoxplotChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  ToolboxComponent,
  BrushComponent,
  AriaComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
export function createWorkspaceChart(
  host: HTMLElement,
  select: (marks: ChartMark[], add: boolean) => void,
) {
  const chart = echarts.init(host, undefined, { renderer: "canvas" });
  let report: ChartReport | undefined;
  let maps: ChartMark[][] = [];
  let signature = "";
  let drawing = false;
  let brushArmed = false;
  let brushReleased = false;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  // Own the hover delay so chart replacement/disposal can cancel it. ECharts
  // 6.1's delayed item callbacks can outlive a disposed tooltip component.
  const cancelHover = () => {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
  };
  chart.on("mouseover", (event: any) => {
    cancelHover();
    const target = event.data?.chartRow
      ? { seriesIndex: event.seriesIndex, dataIndex: event.dataIndex }
      : event.componentType === "legend"
        ? { legendIndex: event.componentIndex, name: event.value }
        : null;
    if (!target) return;
    const captured = report;
    hoverTimer = setTimeout(() => {
      if (disposed || report !== captured) return;
      chart.dispatchAction({
        type: "showTip",
        ...target,
      });
    }, TOOLTIP_DELAY_MS);
  });
  chart.on("mouseout", () => {
    cancelHover();
    chart.dispatchAction({ type: "hideTip" });
  });
  chart.on("globalout", cancelHover);
  const armBrush = () => {
    brushArmed = true;
    brushReleased = false;
  };
  host.addEventListener("pointerdown", armBrush);
  chart.on("legendselectchanged", () => (brushArmed = false));
  chart.on("datazoom", () => (brushArmed = false));
  (host as any).workspaceChart = chart;
  const draw = () => {
    if (!report || !host.isConnected) return;
    drawing = true;
    try {
      const current = report;
      const c = current.config as ChartConfig;
      const rows = current.rows as any[];
      const stacked = c.stacked && ["bar", "line", "area"].includes(c.kind);
      const dark = document.documentElement.dataset.theme !== "light",
        text = dark ? "#d0d7e2" : "#374151",
        grid = dark ? "#ffffff14" : "#00000018",
        accent = dark ? "#a3c3ff" : "#194fc2",
        second = dark ? "#ffd27a" : "#805000";
      const toolbox = (top = 0) => ({
        top,
        right: 2,
        feature: {
          ...(c.kind === "scatter"
            ? { brush: { type: ["rect", "clear"] } }
            : {}),
          saveAsImage: {
            title: "Save chart as PNG",
            name: c.title.trim() || "chronoscope-chart",
            backgroundColor: dark ? "#151c26" : "#fff",
            pixelRatio: 2,
          },
        },
        iconStyle: { borderColor: text },
      });
      const next = JSON.stringify(c);
      const compact = host.clientWidth < 380;
      if (next !== signature) {
        cancelHover();
        chart.dispatchAction({ type: "hideTip" });
        signature = next;
      }
      if (c.kind === "heatmap") {
        maps = [
          rows.map((r) => ({ x: r.x, series: r.series, value: null, axis: 0 })),
        ];
        const values = rows
          .map((r) => r.y)
          .filter((v) => typeof v === "number");
        const lo = values.length ? Math.min(...values) : 0;
        const hi = values.length ? Math.max(...values) : 1;
        const metric =
          c.y_label.trim() ||
          (c.aggregate === "count"
            ? "Event count"
            : `${operationLabel(c.aggregate)} ${measurementLabel(c.y, report)}`);
        chart.setOption(
          {
            useUTC: true,
            animation: false,
            backgroundColor: "transparent",
            textStyle: {
              color: text,
              fontFamily: getComputedStyle(host).fontFamily,
              fontSize: 11,
            },
            grid: {
              left: compact ? 42 : 84,
              right: compact ? 12 : 24,
              top: compact ? 16 : 32,
              bottom: compact ? 76 : 95,
            },
            toolbox: toolbox(),
            xAxis: {
              type: "category",
              data: Array.from({ length: 24 }, (_, h) => h),
              name: axisLabel(c, "x", report),
              nameLocation: "middle",
              nameGap: 32,
              axisLabel: {
                color: text,
                interval: compact ? 5 : 2,
                hideOverlap: true,
                formatter: (h: number) => hourLabel(Number(h)),
              },
              splitArea: { show: true, areaStyle: { color: [grid] } },
            },
            yAxis: {
              type: "category",
              data: [0, 1, 2, 3, 4, 5, 6],
              inverse: true,
              name: "",
              axisLabel: {
                color: text,
                formatter: (d: number) => weekdays[Number(d)].slice(0, 3),
              },
              splitArea: { show: true, areaStyle: { color: [grid] } },
            },
            visualMap: {
              type: "continuous",
              min: lo,
              max: hi > lo ? hi : lo + 1,
              dimension: 2,
              orient: "horizontal",
              left: "center",
              bottom: 0,
              itemWidth: 12,
              itemHeight: compact ? 120 : 180,
              calculable: false,
              text: [metric, ""],
              textStyle: { color: text },
              inRange: {
                color: dark
                  ? ["#153444", "#197e92", "#59e3df", "#ffce76"]
                  : ["#edf6fa", "#78c6d1", "#08788b", "#153461"],
              },
            },
            tooltip: {
              triggerOn: "none",
              showDelay: 0,
              renderMode: "richText",
              confine: true,
              formatter: (p: any) => {
                const r = p.data.chartRow;
                return `${weekdays[r.series]} · ${hourLabel(r.x)}–${hourLabel(r.x + 1)} UTC\n${metric}: ${r.y === null ? "No measurement" : chartValue(r.y)}\n${r.count.toLocaleString()} matching Events`;
              },
            },
            aria: {
              enabled: true,
              label: {
                description: `UTC weekday by hour ${metric} grid. ${current.input_count} scoped Events. Empty count cells mean zero recorded Events, not proof of no activity. Chart data provides accessible values and source selection.`,
              },
            },
            series: [
              {
                type: "heatmap",
                name: metric,
                data: rows.map((r, i) => ({
                  value: [r.x, r.series, r.y],
                  chartRow: r,
                  mark: maps[0][i],
                })),
                itemStyle: {
                  borderWidth: 1,
                  borderColor: dark ? "#151c26" : "#fff",
                },
                emphasis: {
                  itemStyle: { borderWidth: 2, borderColor: accent },
                },
              },
            ],
          },
          {
            replaceMerge: [
              "series",
              "xAxis",
              "yAxis",
              "visualMap",
              "legend",
              "dataZoom",
              "toolbox",
              "brush",
            ],
          },
        );
        return;
      }
      const key = (x: any) => JSON.stringify(x),
        xs = [...new Map(rows.map((r) => [key(r.x), r])).values()];
      const keys = xs.map((r) => key(r.x));
      const label = (x: any) =>
        c.x_axis === "time" && typeof x === "number"
          ? time(x) + " UTC"
          : chartValue(x);
      const grouped = [
        ...new Map(rows.map((r) => [key(r.series), r.series])).values(),
      ];
      maps = [];
      const series: any[] = [];
      const push = (s: any, marks: ChartMark[]) => {
        series.push(s);
        maps.push(marks);
      };
      for (const group of grouped) {
        const matching = rows.filter((r) => key(r.series) === key(group));
        // Align sparse stacked series by the same timestamp keys. A missing
        // count is zero only when the full chart was returned, never when marks
        // were omitted by a budget. Missing measurements stay missing.
        const byX = new Map(matching.map((r) => [key(r.x), r]));
        const items =
          stacked && c.group
            ? xs.map(
                (r) =>
                  byX.get(key(r.x)) || {
                    x: r.x,
                    series: group,
                    y: c.aggregate === "count" && !current.limited ? 0 : null,
                    y2: null,
                    count: 0,
                  },
              )
            : matching;
        const color =
          c.kind === "period"
            ? Number(group) === 0
              ? accent
              : second
            : c.group
              ? entityColor(String(group ?? "[Missing]"))
              : accent;
        for (const axis of c.y2 ? [0, 1] : [0]) {
          const name =
            c.kind === "period"
              ? periodLabel(group)
              : (c.group ? chartValue(group) + " · " : "") +
                (axis
                  ? measurementLabel(c.y2, report)
                  : c.aggregate === "count" &&
                      !["scatter", "boxplot"].includes(c.kind)
                    ? "Record count"
                    : measurementLabel(c.y, report));
          const marks = items.map((r) => ({
            x: r.x,
            series: r.series,
            value: c.kind === "scatter" ? r.y : null,
            axis,
          }));
          const data = items.map((r, index) => {
            const y = axis ? r.y2 : r.y;
            const x =
              c.kind === "histogram" ||
              c.x_axis === "category" ||
              c.kind === "boxplot"
                ? key(r.x)
                : c.x_axis === "time"
                  ? Number(r.x) * 1000
                  : r.x;
            return {
              id: key([r.x, r.series, axis, c.kind === "scatter" ? r.y : null]),
              value:
                c.kind === "boxplot"
                  ? [keys.indexOf(key(r.x)), ...r.box]
                  : [x, y],
              name:
                c.kind === "histogram"
                  ? `${chartValue(r.range[0])} – ${chartValue(r.range[1])}`
                  : label(r.x),
              chartRow: r,
              mark: marks[index],
              itemStyle: { color: axis ? second : color },
            };
          });
          push(
            {
              id: key([group, axis]),
              name,
              type:
                c.kind === "boxplot"
                  ? "boxplot"
                  : c.kind === "scatter"
                    ? "scatter"
                    : c.kind === "bar" ||
                        c.kind === "histogram" ||
                        c.kind === "period"
                      ? "bar"
                      : "line",
              yAxisIndex: axis,
              encode:
                c.kind === "boxplot" ? { x: 0, y: [1, 2, 3, 4, 5] } : undefined,
              data,
              stack: stacked && !axis ? "primary" : undefined,
              areaStyle:
                c.kind === "area" && !axis ? { opacity: 0.18 } : undefined,
              lineStyle: {
                width: 2,
                type: axis ? "dashed" : "solid",
                color: axis ? second : color,
              },
              itemStyle: {
                color: axis ? second : color,
                opacity: c.kind === "scatter" ? 0.65 : 0.85,
              },
              symbolSize:
                c.kind === "scatter"
                  ? (_v: any, p: any) =>
                      Math.min(22, 5 + Math.sqrt(p.data.chartRow.count) * 1.5)
                  : 6,
              showSymbol: items.length < 100,
              emphasis: { focus: "series" },
              connectNulls: false,
            },
            marks,
          );
          if (c.kind === "boxplot") {
            const outliers = items.flatMap((r) =>
              (r.outliers || []).map((v: number) => ({
                value: [keys.indexOf(key(r.x)), v],
                name: label(r.x),
                chartRow: { ...r, y: v, box: undefined, count: null },
                mark: { x: r.x, series: r.series, value: v, axis: 0 },
              })),
            );
            if (outliers.length)
              push(
                {
                  id: key([group, "outliers"]),
                  name: name + " · outliers",
                  type: "scatter",
                  symbolSize: 5,
                  itemStyle: { color },
                  data: outliers,
                },
                outliers.map((d) => d.mark),
              );
          }
        }
      }
      if (current.trend) {
        const t = current.trend as any;
        push(
          {
            id: "ols-trend",
            name: "OLS · full scope",
            type: "line",
            showSymbol: false,
            lineStyle: { color: second, width: 2, type: "dashed" },
            data: [
              [
                c.x_axis === "time" ? t.min_x * 1000 : t.min_x,
                t.min_x * t.slope + t.intercept,
              ],
              [
                c.x_axis === "time" ? t.max_x * 1000 : t.max_x,
                t.max_x * t.slope + t.intercept,
              ],
            ],
            silent: true,
          },
          [],
        );
      }
      const xCategory =
        c.kind === "histogram" ||
        c.kind === "boxplot" ||
        c.x_axis === "category";
      const xLabel = (k: string) => {
        const r = xs.find((r) => key(r.x) === k);
        if (!r) return k;
        return c.kind === "histogram"
          ? `${chartValue(r.range[0])}–${chartValue(r.range[1])}`
          : label(r.x);
      };
      const tooltip = (p: any) => {
        const r = p.data?.chartRow;
        if (!r) return "";
        const y = p.data.mark?.axis ? r.y2 : r.y;
        return [
          p.data.name,
          c.group ? `${fieldLabel(c.group)}: ${chartValue(r.series)}` : "",
          r.box
            ? `Whiskers ${chartValue(r.box[0])} – ${chartValue(r.box[4])}\nQ1 ${chartValue(r.box[1])} · Median ${chartValue(r.box[2])} · Q3 ${chartValue(r.box[3])}`
            : `${p.seriesName}: ${chartValue(y)}`,
          r.count == null ? "" : `${r.count.toLocaleString()} matching records`,
          c.kind === "period"
            ? `A: ${chartValue(r.before)} · B: ${chartValue(r.after)}\nChange: ${r.change === null ? "No measurement" : chartValue(r.change)} · ${r.percent_change === null ? "Percentage undefined" : chartValue(r.percent_change) + "%"}\n${periodLabel(r.series)}: ${(current.config[Number(r.series) === 0 ? "period_a" : "period_b"] || []).map((t: number) => time(t)).join(" → ")} UTC (end excluded)`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      };
      const axisName = (axis: number) =>
        axisLabel(c, axis ? "y2" : "y", report);
      chart.setOption(
        {
          // Data buckets, tooltips and the workspace timeline all use UTC.
          useUTC: true,
          animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
          animationDuration: 0,
          animationDurationUpdate: 150,
          backgroundColor: "transparent",
          textStyle: {
            color: text,
            fontFamily: getComputedStyle(host).fontFamily,
            fontSize: 11,
          },
          color: grouped.map((g) =>
            c.group ? entityColor(String(g)) : accent,
          ),
          grid: {
            left: compact ? 60 : 80,
            right: c.y2 ? (compact ? 60 : 80) : 20,
            top: series.length > 1 ? 45 : 32,
            bottom: 72,
          },
          legend: {
            show: series.length > 1,
            triggerEvent: true,
            type: "scroll",
            top: 2,
            textStyle: { color: text, fontSize: 11 },
            pageTextStyle: { color: text },
            tooltip: { show: true, showDelay: 0 },
          },
          tooltip: {
            triggerOn: "none",
            showDelay: 0,
            hideDelay: 100,
            trigger: "item",
            renderMode: "richText",
            confine: true,
            formatter: tooltip,
          },
          toolbox: toolbox(series.length > 1 ? 22 : 0),
          brush:
            c.kind === "scatter"
              ? {
                  toolbox: ["rect", "clear"],
                  brushMode: "single",
                  throttleType: "debounce",
                  throttleDelay: 200,
                  xAxisIndex: 0,
                  yAxisIndex: 0,
                  brushStyle: {
                    color: dark ? "#a3c3ff14" : "#194fc214",
                    borderColor: text,
                    borderWidth: 1,
                  },
                }
              : undefined,
          xAxis: {
            type: xCategory
              ? "category"
              : c.x_axis === "time"
                ? "time"
                : "value",
            data: xCategory ? keys : undefined,
            name:
              axisLabel(c, "x", report).slice(0, 60) +
              (c.kind !== "histogram" && c.x_axis === "time" ? " (UTC)" : ""),
            nameLocation: "middle",
            nameGap: 32,
            nameTextStyle: { color: text },
            axisLabel: {
              color: text,
              hideOverlap: true,
              formatter: xCategory
                ? xLabel
                : c.x_axis === "time"
                  ? (value: number) => {
                      const span = Number(rows.at(-1)?.x) - Number(rows[0]?.x);
                      const epoch = Number(value) / 1000;
                      return span < 300
                        ? displayClock(epoch, true)
                        : displayDate(epoch) +
                            (span <= 172800 ? " " + displayClock(epoch) : "");
                    }
                  : undefined,
            },
            axisLine: { lineStyle: { color: grid } },
            splitLine: { show: !xCategory, lineStyle: { color: grid } },
          },
          yAxis: (c.y2 ? [0, 1] : [0]).map((axis) => ({
            type: "value",
            name: axisName(axis).slice(0, 60),
            nameLocation: "middle",
            nameGap: compact ? 44 : 61,
            nameTextStyle: { color: text },
            scale: c.kind === "scatter",
            axisLabel: { color: text, hideOverlap: true },
            splitLine: { show: axis === 0, lineStyle: { color: grid } },
          })),
          dataZoom: [
            {
              type: "inside",
              zoomOnMouseWheel: "ctrl",
              moveOnMouseWheel: false,
            },
            {
              type: "slider",
              height: 14,
              bottom: 0,
              textStyle: { color: text },
              borderColor: grid,
            },
          ],
          aria: {
            enabled: true,
            label: {
              description: `${c.kind} chart of ${axisName(0)} by ${fieldLabel(c.kind === "histogram" ? c.y : c.x)}. ${current.input_count} scoped source records; ${rows.length} of ${current.total_marks} chart marks displayed. Chart data provides accessible values and source-record selection.`,
            },
          },
          series,
        },
        {
          replaceMerge: [
            "series",
            "yAxis",
            "xAxis",
            "visualMap",
            "legend",
            "dataZoom",
            "toolbox",
            "brush",
          ],
        },
      );
    } finally {
      drawing = false;
    }
  };
  chart.on("click", (event: any) => {
    if (brushReleased) return;
    brushArmed = false;
    const mark = event.data?.mark;
    if (mark) select([mark], !!event.event?.event?.shiftKey);
  });
  chart.on("brushEnd", (event: any) => {
    if (drawing || !brushArmed) return;
    if (!event.areas?.length) {
      brushArmed = false;
      return;
    }
    // Brush previews can arrive during a slow drag, before any points are in
    // the rectangle. Select once, from the final native ECharts brush result.
    brushReleased = true;
    chart.dispatchAction({ type: "brush", areas: event.areas });
  });
  chart.on("brushSelected", (event: any) => {
    if (
      drawing ||
      !brushArmed ||
      !brushReleased ||
      !event.batch?.[0]?.areas?.length
    )
      return;
    brushArmed = false;
    brushReleased = false;
    const marks = (event.batch[0].selected || []).flatMap((s: any) =>
      s.dataIndex
        .map((index: number) => maps[s.seriesIndex]?.[index])
        .filter(Boolean),
    );
    if (marks.length) select(marks, false);
  });
  const resize = new ResizeObserver(() => {
    chart.resize();
    draw();
  });
  resize.observe(host);
  const theme = new MutationObserver(draw);
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return {
    update: (next: ChartReport) => {
      cancelHover();
      report = next;
      draw();
    },
    dispose: () => {
      disposed = true;
      cancelHover();
      resize.disconnect();
      theme.disconnect();
      host.removeEventListener("pointerdown", armBrush);
      chart.dispose();
      delete (host as any).workspaceChart;
    },
  };
}
