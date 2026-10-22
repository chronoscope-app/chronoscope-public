// Compile-only checks for the generated transport boundary. Never imported by UI.
import { call } from "./bridge";
export function checkContracts() {
  void call("select", { ids: ["9007199254740993"] });
  void call("job_start", {
    command: "terrain_mesh",
    arguments: { bounds: [-80, 43, -79, 44], resolution: 129 },
  });
  // @ts-expect-error IDs must remain exact strings.
  void call("select", { ids: [9007199254740993] });
  // @ts-expect-error Unknown operations must not reach the transport.
  void call("run_shell", {});
  // @ts-expect-error Coordinates require a complete typed representation.
  void call("coordinates", { coordinate: { system: "dd", latitude: 43 } });
  void call("job_start", {
    command: "terrain_mesh",
    // @ts-expect-error Job arguments follow the selected operation's schema.
    arguments: { bounds: [-80, 43, -79] },
  });
}
