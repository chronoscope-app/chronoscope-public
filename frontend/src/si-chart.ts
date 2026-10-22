import { TOOLTIP_DELAY_MS } from "./tooltips";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

/** Bounded columns from a Rust result, never a service-provided executable option. */
export function createResultChart(
  host: HTMLElement,
  rows: Record<string, any>[],
  kind: "bar" | "line" | "scatter",
  x: string,
  y: string,
  select: (row: Record<string, any>) => void,
) {
  const chart = echarts.init(host, undefined, { renderer: "canvas" });
  const data = rows.filter(
    (r) =>
      typeof r[y] === "number" &&
      Number.isFinite(r[y]) &&
      (kind !== "scatter" ||
        (typeof r[x] === "number" && Number.isFinite(r[x]))),
  );
  const draw = () => {
    const dark = document.documentElement.dataset.theme !== "light";
    const color = dark ? "#a3c3ff" : "#194fc2",
      text = dark ? "#d0d7e2" : "#374151";
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      color: [color],
      grid: {
        left: 62,
        right: 18,
        top: 24,
        bottom: data.length > 30 ? 70 : 45,
      },
      tooltip: {
        showDelay: TOOLTIP_DELAY_MS,
        trigger: "item",
        renderMode: "richText",
        confine: true,
      },
      xAxis: {
        type: kind === "scatter" ? "value" : "category",
        data:
          kind === "scatter"
            ? undefined
            : data.map((r) => String(r[x] ?? "Missing")),
        axisLabel: { color: text, hideOverlap: true },
        axisLine: { lineStyle: { color: text } },
      },
      yAxis: {
        type: "value",
        scale: kind === "scatter",
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: dark ? "#ffffff14" : "#00000018" } },
      },
      dataZoom:
        data.length > 30
          ? [
              {
                type: "inside",
                zoomOnMouseWheel: "ctrl",
                moveOnMouseWheel: false,
              },
              {
                type: "slider",
                height: 16,
                bottom: 5,
                textStyle: { color: text },
              },
            ]
          : [],
      series: [
        {
          type: kind,
          data: data.map((r) => (kind === "scatter" ? [r[x], r[y]] : r[y])),
          symbolSize: 7,
          lineStyle: { width: 2 },
          showSymbol: data.length < 100,
          itemStyle: { opacity: 0.85 },
        },
      ],
    });
  };
  draw();
  chart.on("click", (event) => {
    if (typeof event.dataIndex === "number" && data[event.dataIndex])
      select(data[event.dataIndex]);
  });
  const resize = new ResizeObserver(() => chart.resize());
  resize.observe(host);
  const theme = new MutationObserver(() => {
    if (host.isConnected) draw();
  });
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    resize.disconnect();
    theme.disconnect();
    chart.dispose();
  };
}
