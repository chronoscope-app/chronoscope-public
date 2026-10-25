import { call, chooseFile } from "./bridge";
import type { EngineContracts } from "./contracts";

type OpenResult = Exclude<EngineContracts["open"]["result"], { dry_run: true }>;
interface Host {
  settle: () => Promise<void>;
  guard: (action: string) => Promise<boolean>;
  pause: () => void;
  importData: (path: string) => Promise<void>;
  importGis: (path: string, format: string) => Promise<void>;
  opened: (path: string, result: OpenResult) => Promise<void>;
  task: <T>(label: string, action: () => Promise<T>) => Promise<T>;
  notice: (message: string) => void;
}
const tabular = ["csv", "tsv", "xlsx", "xls", "xlsb"];
const gis = [
  "shp",
  "gpkg",
  "geojson",
  "topojson",
  "json",
  "kml",
  "kmz",
  "czml",
  "gpx",
  "gltf",
  "glb",
];

/** File routing and native dialogs. Save serialization lives in WorkspaceController. */
export class WorkspaceFiles {
  constructor(private host: Host) {}
  async open() {
    const path = await chooseFile({
      title: "Open workspace or data",
      filters: [
        {
          name: "Chronoscope workspaces and data",
          extensions: [...new Set(["chronoscope", ...tabular, ...gis])],
        },
        { name: "Chronoscope workspaces", extensions: ["chronoscope", "json"] },
        { name: "CSV and Excel", extensions: tabular },
        { name: "GIS data and 3D assets", extensions: gis },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!path) return;
    return this.openPath(path);
  }
  async openPath(path: string) {
    const extension = path.split(".").pop()?.toLowerCase() || "";
    const probe = gis.includes(extension)
      ? await this.host.task("Identifying file…", () =>
          call("file_probe", { path }),
        )
      : null;
    const workspace =
      extension === "chronoscope" || probe?.kind === "workspace";
    await this.host.settle();
    if (
      !(await this.host.guard(
        workspace ? "open another workspace" : "import data",
      ))
    )
      return;
    this.host.pause();
    if (probe?.kind === "gis") return this.host.importGis(path, probe.format!);
    if (!workspace) return this.host.importData(path);
    await this.host.task("Opening workspace…", async () => {
      const result = await call("open", { path });
      await this.host.opened(path, result);
      if (result.missing_resources?.length)
        this.host.notice(result.missing_resources.join("; "));
    });
  }
  async exportEvents() {
    const path = await chooseFile({ save: true, defaultPath: "events.csv" });
    if (path) {
      const result = await call("export", { path });
      this.host.notice(`Exported ${result.exported} events`);
    }
  }
}
