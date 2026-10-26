# Idle camera roundoff and unnecessary Cesium renders

This is the handoff for investigating an upstream CesiumJS issue. Chronoscope
ships a small application workaround; a Cesium PR should address the underlying
camera-state mutation. Upstream [PR #13982](https://github.com/CesiumGS/cesium/pull/13982) is open as checked on 25 October 2026. The pinned application dependency does not include that unmerged change. See the [workaround index](maintenance/WORKAROUNDS.md) for the retirement gate.

## Observed behavior

An idle Chronoscope scene continued drawing despite `requestRenderMode`. With
the same data, camera, drawing-buffer size and display budget, stabilizing only
tiny orientation changes stopped those draws. Three native Linux/Radeon rounds
measured 24–41 idle draws per four seconds before the workaround and zero after
it. Summed app-process CPU fell from about 19–24% of one core to 3.5–3.8%.
Active navigation FPS was essentially unchanged.

See the [measurement report](validation/radeon-performance-2026-10-24/README.md)
and [sanitized receipts](validation/radeon-performance-2026-10-24/results.json)
for the workloads, exact marker counts, image comparisons and limitations. The
later Radeon runtime-suspend failure is recorded there separately; it occurred
after the successful hardware measurements and is not evidence of a Cesium bug.

## Suspected upstream mechanism, with a CPU-only reproduction

The installed versions are CesiumJS **1.146.0** and `@cesium/engine` **26.4.0**.
Inspection shows this path:

1. `Scene.initializeFrame` calls `Camera._updateCameraChanged`.
2. If `camera.changed` has any listener, that method reads `heading` and `roll`.
3. Those getters temporarily call `_setTransform` into the camera's local ENU
   frame and then restore its previous transform. `pitch` has the same pattern.
4. The round trip recomputes/normalizes the public camera basis and can introduce
   floating-point differences. Repeated reads can accumulate them.
5. `View.checkForCameraUpdates` compares the camera with its last clone using
   `CesiumMath.EPSILON15`. A difference beyond that tolerance reports movement.
6. `Scene.render` includes that camera-change result in its decision to render,
   even when request-render mode is enabled.

This is more specific than an idle scene receiving legitimate render requests
from tile loads, imagery readiness, animation, clock changes or application code.
Those causes must be excluded in an upstream browser reproduction.

Run this from the repository root, with the frontend's locked dependencies
installed (`npm --prefix frontend ci` if needed):

```sh
node frontend/scripts/cesium-camera-roundoff-repro.mjs
```

The diagnostic uses the actual Cesium `Camera` and actual `View` comparison,
without constructing WebGL framebuffers or starting Chronoscope. It runs one
fixed 3D pose for 600 simulated update/check cycles, with no camera commands
during the loop. The recorded Node 24.22.1 result is:

| Case | False camera-change detections | Position changed? |
| --- | ---: | --- |
| No `changed` listener | 0 | No |
| One no-op `changed` listener | 93 | No |
| Same listener, Chronoscope stabilizer enabled | 0 | No |

The listener case accumulated a maximum basis-component difference of about
`1.02e-13`. The control and stabilized cases ended with an exact zero difference.
[Machine-readable result](validation/radeon-performance-2026-10-24/cesium-roundoff.json).
These counts are **change-detector results, not rendered frames, elapsed time or
FPS**. Private Cesium methods are used only in this diagnostic to isolate the
mechanism. The production workaround does not call them.

## Upstream source checked

On 24 October 2026, upstream `main` resolved to
`ad366f071293b28bdf330c822965b8bd0bdeb781`. The installed `Camera.js` and `View.js`
were byte-identical to those files at that revision:

| File | Git blob SHA |
| --- | --- |
| [Camera.js](https://github.com/CesiumGS/cesium/blob/ad366f071293b28bdf330c822965b8bd0bdeb781/packages/engine/Source/Scene/Camera.js) | `7be63a530914c9f353bc66c498c2a849e8e8d6b5` |
| [View.js](https://github.com/CesiumGS/cesium/blob/ad366f071293b28bdf330c822965b8bd0bdeb781/packages/engine/Source/Scene/View.js) | `8c2ec658f789d67ec5ef2a0d03258e0ee7b29b4a` |

This establishes that the relevant source path remains in current upstream. It
does not claim that the complete upstream checkout and its newer dependencies
have been built or tested. Recheck the current commit and search for duplicate
issues before submitting. Other request-render issues, such as
[billboard image readiness #11820](https://github.com/CesiumGS/cesium/issues/11820),
have different triggers; their existence does not establish a duplicate.

## Chronoscope's workaround and its limits

Implementation: [camera-stability.ts](../frontend/src/camera-stability.ts), wired
once per viewer to `scene.preUpdate` in [view.ts](../frontend/src/view.ts).

The stabilizer remembers position, all 16 transform components, scene mode and
the nine direction/up/right components. It restores the previous orientation
only when position, transform and mode are exactly unchanged and every basis
component differs by at most `1e-14`. Otherwise it accepts the new pose as its
reference. It never rewrites the position or frustum. Frustum changes can still
trigger rendering through Cesium's normal detection.

This deliberately narrow workaround can absorb an explicit orientation change
at or below that threshold when all other checked state is identical. It does
not solve getter roundoff that changes position or reference frame. For example,
a separate Columbus View math probe also observed position roundoff; that wider
case is outside this orientation-only guard. Do not present the helper as a
universal fix for all idle rendering or all camera precision problems.

Six [unit cases](../frontend/scripts/camera-stability-test.mjs) cover repeated
roundoff, larger real rotation, tiny orientation changes accompanied by position,
transform or mode changes, and invalid orientation values. Browser/native checks
also exercise ordinary navigation, all three modes, selection, playback and
render recovery. Image comparisons retain raw hashes and allow at most one
8-bit channel step in 0.1% of pixels; the output is not universally byte-identical.

The optional [native profiler](../scripts/profile_native.mjs) can compare the
unmodified frontend with the injected workaround in a disposable WebKitGTK
instance. See the measurement report for setup. It must not be used to call an
already-patched build an unmodified baseline.

## Recommendation for a Cesium contribution

Yes: the reproduced getter side effect and unnecessary camera-change detections
are worth an upstream bug report and a focused fix PR. The likely better fix is
to compute heading/pitch/roll using scratch coordinates without changing the
camera, or to preserve its full observable state across getter evaluation.
Exactly how to preserve internal caches needs upstream review. Copying this
application hook or widening the global comparison epsilon would conceal the
side effect and could absorb intentional small camera movement.

Before opening a PR:

- Reproduce in a minimal Sandcastle/Scene example on current Cesium `main`, with
  a no-op `changed` listener, fixed clock and no asynchronous tile/imagery work.
  Count `postRender` events after warm-up, rather than animation callbacks.
- Add Cesium regression specs showing that individual and repeated heading,
  pitch and roll reads preserve the initialized pose and derived camera state.
  Cover 3D, Columbus View, 2D and nonidentity reference frames.
- Verify that request-render mode becomes idle and that genuine translation,
  rotation, zoom/frustum changes and mode transitions still request frames.
- Follow the current [Cesium testing guide](https://github.com/CesiumGS/cesium/blob/main/Documentation/Contributors/TestingGuide/README.md)
  and contribution requirements. Keep the eventual upstream patch independent
  of Chronoscope's data, Tauri setup and GPU-specific launch workarounds.

The CPU-only diagnostic and measured app behavior make a strong starting case;
the minimal browser reproduction and an upstream implementation remain to be
done. OpenClaw can use this document and the standalone diagnostic as the handoff.
