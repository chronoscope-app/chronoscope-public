/** Decode bridge payloads without a per-character mapping callback or boxed array. */
export function base64Bytes(data: string): Uint8Array<ArrayBuffer> {
  const decode = (
    Uint8Array as Uint8ArrayConstructor & {
      fromBase64?: (data: string) => Uint8Array<ArrayBuffer>;
    }
  ).fromBase64;
  if (typeof decode === "function") return decode.call(Uint8Array, data);

  // Older WebViews still have atob. Keep its validation and copy straight into
  // the final buffer instead of Uint8Array.from's generic string iterator.
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
