import { SpaceTimeView } from "./view";
import type { Point } from "./types";
import type { ResidentPlayback } from "./resident-playback";

/** Deliberately local: a hands-on renderer experiment, not an analytical view. */
export async function openVfxPlayground() {
  const root = document.createElement("section");
  root.id = "vfx-playground";
  root.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:#10141b;display:flex;flex-direction:column;color:#dce7f1";
  root.innerHTML = `<header style="padding:12px 18px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;border-bottom:1px solid #3b4656">
    <strong>Chronoscope · Local VFX preview</strong>
    <button id="vfx-play" type="button">Pause</button>
    <label>Renderer <select id="vfx-renderer"><option value="gpu">GPU preview</option><option value="current">Current renderer</option></select></label>
    <label>Events <select id="vfx-count"><option value="100000">100,000</option><option value="10000">10,000</option></select></label>
    <label>Speed <select id="vfx-speed"><option value=".25">0.25×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
    <button id="vfx-fit" type="button">Fit</button>
    <output id="vfx-status" role="status">Preparing preview…</output>
    <label style="display:flex;align-items:center;gap:10px;flex:1 1 260px">Time window <input id="vfx-time" type="range" min="0" max="80" step=".01" value="0" style="min-width:150px;width:100%"></label>
  </header>
  <div style="padding:6px 18px;font-size:12px;color:#aebdcd">Local visual experiment · Synthetic regional Globe data · Drag to pan; wheel to zoom; Ctrl-drag to orbit · Picking, terrain and exact workspace filtering are not included.</div>
  <div id="vfx-canvas" style="position:relative;flex:1;min-height:0"></div>`;
  document.body.append(root);
  document.title = "Chronoscope — Local VFX Preview";
  const host = root.querySelector<HTMLElement>("#vfx-canvas")!;
  const play = root.querySelector<HTMLButtonElement>("#vfx-play")!;
  const renderer = root.querySelector<HTMLSelectElement>("#vfx-renderer")!;
  const count = root.querySelector<HTMLSelectElement>("#vfx-count")!;
  const speed = root.querySelector<HTMLSelectElement>("#vfx-speed")!;
  const slider = root.querySelector<HTMLInputElement>("#vfx-time")!;
  const status = root.querySelector<HTMLOutputElement>("#vfx-status")!;
  const v = new SpaceTimeView(host, () => {});
  await v.ready;
  // Hold quality equal across both renderer choices for this visual comparison.
  clearTimeout((v as any).resourceTimer);
  (v as any).resourceGovernor.level = 0;
  (v as any).applyResourceGraphics();
  v.onViewportChange = () => {};
  v.onSceneChange = () => {};
  v.setMode("globe");
  v.setPlaybackFade(false);
  v.setDisplayOptions({
    ...v.display,
    mode: "points",
    show_points: true,
    show_tracks: true,
    show_trails: false,
    trail_pixels: 0,
    trail_gap_minutes: 0,
    bloom: false,
  });
  v.scene.globe.show = false;
  const epoch = 1735689600,
    bounds: [number, number, number, number] = [-80.1, 31.9, -79.3, 32.5];
  const names = Array.from({ length: 100 }, (_, i) => `Track ${i}`);
  const all: Point[] = Array.from({ length: 100000 }, (_, i) => ({
    id: String(i + 1),
    entity: i % 100,
    time: epoch + Math.floor(i / 100),
    lat: 32 + (i % 100) * 0.004 + Math.sin(i / 100 / 35) * 0.025,
    lon: -80 + Math.floor(i / 100) * 0.0005 + Math.cos(i / 100 / 35) * 0.025,
    value: i % 100,
  }));
  let points = all,
    span = 999,
    phase = 0,
    playing = true,
    changing = false,
    scrubbing = false;
  let preview: ResidentPlayback | undefined,
    pending: Promise<unknown> | undefined;
  let lastPacket = -Infinity,
    lastTick = performance.now(),
    lastStats = lastTick;
  let frames = 0,
    fps = 0;
  v.scene.postRender.addEventListener(() => frames++);
  const packet = () => {
    const first = Math.min(
      points.length - 1,
      Math.floor(phase * (span + 1)) * 100,
    );
    return points.slice(first, first + Math.ceil(points.length * 0.2));
  };
  const showStatus = () => {
    status.textContent = `${renderer.value === "gpu" ? "GPU preview" : "Current renderer"} · ${points.length.toLocaleString()} events · ${fps.toFixed(0)} rendered FPS`;
  };
  const configure = async () => {
    changing = true;
    renderer.disabled = count.disabled = true;
    status.textContent = "Preparing preview…";
    try {
      await pending;
      preview?.destroy();
      preview = undefined;
      v.setPlayback(false);
      points = all.slice(0, Number(count.value));
      span = Math.max(1, points[points.length - 1].time - epoch);
      phase = 0;
      slider.value = "0";
      (v as any).glyphs.show = true;
      (v as any).trails.show = true;
      await v.setData(packet(), names, bounds, [epoch, epoch + span]);
      if (renderer.value === "gpu") {
        preview = v.createResidentPlayback(points);
        (v as any).glyphs.show = false;
        (v as any).trails.show = false;
        if ((v as any).stemsPrimitive) (v as any).stemsPrimitive.show = false;
        preview.setWindow(epoch, epoch + span * 0.2);
      }
      v.setPlayback(true);
      (v.viewer as { targetFrameRate: number | undefined }).targetFrameRate =
        undefined;
      v.fit();
      v.requestRender();
      lastTick = performance.now();
      lastPacket = -Infinity;
      showStatus();
    } catch (error) {
      playing = false;
      play.textContent = "Play";
      status.textContent = `Preview error: ${String(error)}`;
    } finally {
      changing = false;
      renderer.disabled = count.disabled = false;
    }
  };
  const toggle = () => {
    playing = !playing;
    play.textContent = playing ? "Pause" : "Play";
    lastTick = performance.now();
  };
  play.addEventListener("click", toggle);
  renderer.addEventListener("change", () => void configure());
  count.addEventListener("change", () => void configure());
  slider.addEventListener("pointerdown", () => {
    scrubbing = true;
  });
  slider.addEventListener("pointerup", () => {
    scrubbing = false;
  });
  slider.addEventListener("pointercancel", () => {
    scrubbing = false;
  });
  slider.addEventListener("input", () => {
    phase = Number(slider.value) / 100;
    lastPacket = -Infinity;
  });
  root.querySelector("#vfx-fit")!.addEventListener("click", () => v.fit());
  root.addEventListener(
    "keydown",
    (e) => {
      if (
        e.code === "Space" &&
        !(e.target as Element).closest("button,input,select")
      ) {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    },
    true,
  );
  await configure();
  (window as any).__vfxPlayground = {
    view: v,
    get preview() {
      return preview;
    },
    get playing() {
      return playing;
    },
    get changing() {
      return changing;
    },
    get phase() {
      return phase;
    },
  };
  let frame = 0;
  const tick = (now: number) => {
    const elapsed = now - lastTick;
    lastTick = now;
    if (!changing) {
      if (playing && !scrubbing)
        phase =
          (phase +
            (((elapsed / 1000) * 12) / (span + 1)) * Number(speed.value)) %
          0.8;
      if (!scrubbing) slider.value = String(phase * 100);
      if (preview)
        preview.setWindow(epoch + phase * span, epoch + (phase + 0.2) * span);
      else if (!pending && now - lastPacket >= 100) {
        lastPacket = now;
        pending = Promise.resolve(
          v.setData(packet(), names, bounds, [epoch, epoch + span]),
        )
          .catch((error) => {
            playing = false;
            play.textContent = "Play";
            status.textContent = String(error);
          })
          .finally(() => {
            pending = undefined;
          });
      }
      v.requestRender();
    }
    if (now - lastStats >= 1000) {
      fps = (frames / (now - lastStats)) * 1000;
      frames = 0;
      lastStats = now;
      if (!changing) showStatus();
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frame);
      preview?.destroy();
      v.dispose();
    },
    { once: true },
  );
}
