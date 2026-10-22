import {
  renderGroundEffects,
  type GroundEffectRequest,
} from "./cesium-effects-math";
self.onmessage = (
  event: MessageEvent<GroundEffectRequest & { id: number }>,
) => {
  try {
    const result = renderGroundEffects(event.data);
    self.postMessage(
      { id: event.data.id, ...result },
      { transfer: [result.image.buffer] },
    );
  } catch (error) {
    self.postMessage({ id: event.data.id, error: String(error) });
  }
};
