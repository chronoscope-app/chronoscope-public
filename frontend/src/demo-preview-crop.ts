/** Measured side mattes for the bundled JPEGs. Hash checks keep these bounds
 * tied to their captures; native WebViews do not need canvas pixel access. */
export const bundledPreviewCrops: Record<
  string,
  { width: number; height: number; left: number; right: number; sha256: string }
> = {
  "animal-gps-map.jpg": {
    width: 480,
    height: 300,
    left: 47,
    right: 433,
    sha256: "9ae049427fe742b001b40da7a2b7d85deef2a50b3b70b619d07650300e6de8c6",
  },
  "animal-gps-time.jpg": {
    width: 480,
    height: 300,
    left: 47,
    right: 433,
    sha256: "9b3bd4d55d131533e5d25fe1200b200baf4d440d91bfedbbf74eedf4e3d2be26",
  },
  "earthquakes-globe.jpg": {
    width: 480,
    height: 300,
    left: 58,
    right: 426,
    sha256: "dbb551aab60df514e3d9742b27e8312e636558e7a711592e00c230e958179917",
  },
  "earthquakes-january-globe.jpg": {
    width: 480,
    height: 300,
    left: 59,
    right: 427,
    sha256: "f8432b402a947b8c5c8e2126f410b5ed7bc60d0ef2f4b7d26d356ceeaab33b35",
  },
  "earthquakes-january-map.jpg": {
    width: 480,
    height: 300,
    left: 44,
    right: 436,
    sha256: "e14d3826e5283085fd89f60740dcc0cb8f3f9741ffb6dec7f3af04e72fca6458",
  },
  "earthquakes-map.jpg": {
    width: 480,
    height: 300,
    left: 44,
    right: 436,
    sha256: "de67f989ac4ffaecc87969308d363e031d34e6e30edd1e6435637379c0b28000",
  },
  "electricity-access-1990.jpg": {
    width: 480,
    height: 300,
    left: 45,
    right: 435,
    sha256: "271f60d5250d28b89281e436827df2beb4f2d5c5fb4f464b598920a7f7b390b6",
  },
  "electricity-access-2023.jpg": {
    width: 480,
    height: 300,
    left: 45,
    right: 436,
    sha256: "e38e7131963f073c1929db6fdb638fb2ac518a778a2f732fef5bfb3a236cb23b",
  },
  "elephant-seals-map.jpg": {
    width: 480,
    height: 300,
    left: 47,
    right: 435,
    sha256: "e9fab33ef2aee74d69a5ced9965c51cd711bc9f8ecbf71fdeca246a2d6cac085",
  },
  "elephant-seals-time.jpg": {
    width: 480,
    height: 300,
    left: 59,
    right: 435,
    sha256: "25e899a0440782181f1ca5abc45c29fa3c6434b0d27e6b168179c3baccf60447",
  },
  "fire-detections-heat.jpg": {
    width: 480,
    height: 300,
    left: 46,
    right: 435,
    sha256: "b6785419b613956e716e38ff7f73289e3b25128fcade9cb74f915d794bb17171",
  },
  "fire-detections-map.jpg": {
    width: 480,
    height: 300,
    left: 46,
    right: 435,
    sha256: "f019070714f94b97073be3f75ee4a574501f13885b4ea69bc0d8debb0d6987b2",
  },
  "flight-altitude-globe.jpg": {
    width: 480,
    height: 300,
    left: 45,
    right: 434,
    sha256: "6208a685131853fbf1f384369de27dc9819b207581dce7578abe1eb2b9ed8a7e",
  },
  "flight-altitude-time.jpg": {
    width: 480,
    height: 300,
    left: 45,
    right: 434,
    sha256: "764f64ae8ea1a07be79475df08d4c8a6be1cdd73e8f6ba7f74859e0c713b4d58",
  },
  "hurricanes-map.jpg": {
    width: 480,
    height: 300,
    left: 45,
    right: 436,
    sha256: "44c1b8299cb0d888b2a0cfc26e76e4e5babc2c7d9291fc1fdca8ea180e1d34e1",
  },
  "hurricanes-short-map.jpg": {
    width: 480,
    height: 300,
    left: 45,
    right: 436,
    sha256: "0a1a099fc1000997f73c53081ab785727bece8e6fc2f39ad7eb1abab082449f6",
  },
  "hurricanes-short-time.jpg": {
    width: 480,
    height: 300,
    left: 46,
    right: 435,
    sha256: "d7e6969472f076f02004ec1a28c125ca962997b6579d1955ea3b0d75a8724fc7",
  },
  "hurricanes-time.jpg": {
    width: 480,
    height: 300,
    left: 46,
    right: 435,
    sha256: "f5ecd7ef13faeedd38d5b635b9988bf1ee867ff42208e0f536ab2c2d0cdb5f31",
  },
  "local-wildlife-map.jpg": {
    width: 480,
    height: 300,
    left: 47,
    right: 433,
    sha256: "4cdf321c6c2b813166e7fd0fc66622b1da6821d9721cd398ab574463719d96e5",
  },
  "local-wildlife-time.jpg": {
    width: 480,
    height: 300,
    left: 47,
    right: 433,
    sha256: "da64275d202fce8b18d32a97106c9cd93cfc5650b8c35e5c6421f2e704f9dfa1",
  },
  "london-crime-density.jpg": {
    width: 480,
    height: 300,
    left: 36,
    right: 444,
    sha256: "e22ae0cdccb44043677b2a7a8b5c6e60c1a539bd3f18d190cb7ce9a7b0d21b6d",
  },
  "london-crime-heat.jpg": {
    width: 480,
    height: 300,
    left: 36,
    right: 444,
    sha256: "1483929a8256e0f1b6272cd9ec5f7b52fdb85f03a3e134ffa4dde753060dded2",
  },
  "noaa-ais-map.jpg": {
    width: 480,
    height: 300,
    left: 47,
    right: 433,
    sha256: "b01bcc2722b181793b33874c526c47aa06c013d9edbe97868f960850fde06ae4",
  },
  "noaa-ais-time.jpg": {
    width: 480,
    height: 300,
    left: 47,
    right: 433,
    sha256: "64bf98886a292dd52ec8f06cf77b7e3c0c3e9df914adac1c42d041bc3b731bea",
  },
  "starlink-orbits-globe.jpg": {
    width: 480,
    height: 300,
    left: 59,
    right: 426,
    sha256: "76cfc50f59fa864d11c00caed29496e8bd586c956e416bd32e4d38f6ebd06a39",
  },
  "starlink-orbits-time.jpg": {
    width: 480,
    height: 300,
    left: 59,
    right: 426,
    sha256: "6e16765195d93252d031adcb3b9a526227ecd2c2c7dedd482c81c69fd6f6536e",
  },
  "stork-migration-map.jpg": {
    width: 480,
    height: 300,
    left: 47,
    right: 435,
    sha256: "8d560295eb83cfdb1fa9e1c6170d54ecaa665d8eab9b57109b1e2cf83c489881",
  },
  "stork-migration-time.jpg": {
    width: 480,
    height: 300,
    left: 46,
    right: 438,
    sha256: "c76a6cb0f8d7cdba01e653b134bcfb5affec7ae10b35e0df8b621fa0d1ded9ca",
  },
};

/** Detect only uniform dark side mattes, preserving nonuniform scene content. */
export function previewSideCrop(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const flatDark = (x: number) => {
    const sums = [0, 0, 0],
      squares = [0, 0, 0];
    for (let y = 0; y < height; y++) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const value = pixels[offset + channel];
        sums[channel] += value;
        squares[channel] += value * value;
      }
    }
    return sums.every((sum, channel) => {
      const mean = sum / height;
      return mean < 80 && squares[channel] / height - mean * mean < 9;
    });
  };
  const limit = Math.floor(width * 0.24);
  let left = 0,
    right = width;
  while (left < limit && flatDark(left)) left++;
  while (right > width - limit && flatDark(right - 1)) right--;
  // A blank image is not evidence of a matte. Avoid trimming its whole surface.
  if (!limit || !height || left === limit || right === width - limit)
    return { left: 0, right: width };
  // Remove the narrow JPEG transition at the matte boundary as in the mockup.
  return {
    left: left ? left + 2 : 0,
    right: right < width ? right - 2 : width,
  };
}

/** Crop in layout rather than rewriting the credited, bundled source images. */
export function cropDemoPreview(image: HTMLImageElement) {
  const frame = image.closest<HTMLElement>(".demo-preview-image")!;
  const apply = () => {
    try {
      const width = image.naturalWidth,
        height = image.naturalHeight;
      if (!width || !height) return;
      const bundled =
        bundledPreviewCrops[
          (image.getAttribute("src") || "").split("/").at(-1)!
        ];
      let bounds: { left: number; right: number };
      if (bundled?.width === width && bundled.height === height) {
        bounds = bundled;
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(image, 0, 0);
        bounds = previewSideCrop(
          context.getImageData(0, 0, width, height).data,
          width,
          height,
        );
      }
      const { left, right } = bounds;
      const croppedWidth = right - left;
      image.style.width = `${(100 * width) / croppedWidth}%`;
      image.style.marginLeft = `${(-100 * left) / croppedWidth}%`;
      frame.style.aspectRatio = `${croppedWidth} / ${height}`;
    } catch {
      // Preserve the full preview if a future image cannot be read as pixels.
    } finally {
      frame.dataset.previewReady = "true";
    }
  };
  // Unknown same-origin previews can still discover their matte at load time.
  image.addEventListener("load", apply, { once: true });
  if (image.complete) apply();
}
