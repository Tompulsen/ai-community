import assert from "node:assert/strict";
import {
  IMAGE_RATIOS,
  imageRequestSize,
  usesFixedImageSizes,
} from "../app/utils/image-params";

const expected = {
  "1k": [
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "1280x720",
    "720x1280",
    "1024x768",
    "768x1024",
    "1280x544",
  ],
  "2k": [
    "2048x2048",
    "2160x1440",
    "1440x2160",
    "2560x1440",
    "1440x2560",
    "2048x1536",
    "1536x2048",
    "2560x1088",
  ],
  "4k": [
    "2880x2880",
    "3456x2304",
    "2304x3456",
    "3840x2160",
    "2160x3840",
    "3200x2400",
    "2400x3200",
    "3840x1600",
  ],
};
for (const [tier, sizes] of Object.entries(expected)) {
  IMAGE_RATIOS.slice(1).forEach((ratio, index) => {
    const size = imageRequestSize(ratio, tier, "gpt-image-2.5-sunburst");
    assert.equal(size, sizes[index]);
    const [width, height] = size.split("x").map(Number);
    const [rw, rh] = ratio.split(":").map(Number);
    assert.equal(width % 16, 0);
    assert.equal(height % 16, 0);
    assert(Math.max(width, height) <= 3840);
    assert(width * height >= 655360 && width * height <= 8294400);
    assert(Math.max(width / height, height / width) <= 3);
    assert(Math.abs(width / height / (rw / rh) - 1) < 0.03);
  });
}
assert.equal(imageRequestSize(), "auto");
assert.equal(imageRequestSize("auto", "auto", "gpt-image-2"), "auto");
assert.equal(imageRequestSize("16:9", "auto"), "1280x720");
assert.equal(imageRequestSize("auto", "2k"), "2048x2048");
assert.equal(imageRequestSize("auto", "4k"), "2880x2880");
assert.equal(imageRequestSize("9:16", "2K"), "1440x2560");
assert.equal(imageRequestSize("720x1280", "auto"), "720x1280");
assert.equal(imageRequestSize("1792x1024", "auto"), "1280x720");
assert.equal(imageRequestSize("invalid", "invalid"), "auto");
assert.equal(imageRequestSize("16:9", "4k", "dall-e-3"), "1792x1024");
assert.equal(imageRequestSize("9:16", "2k", "dall-e-3"), "1024x1792");
assert.equal(imageRequestSize("auto", "auto", "dall-e-3"), "1024x1024");
assert.equal(imageRequestSize("16:9", "4k", "dall-e-2"), "1024x1024");
assert.equal(imageRequestSize("512x512", "auto", "dall-e-2"), "512x512");
assert.equal(imageRequestSize("16:9", "4k", "gpt-image-1.5"), "1536x1024");
assert.equal(imageRequestSize("9:16", "4k", "gpt-image-1-mini"), "1024x1536");
assert.equal(imageRequestSize("auto", "auto", "gpt-image-1"), "auto");
assert(usesFixedImageSizes("chatgpt-image-latest"));
assert(!usesFixedImageSizes("gpt-image-2.5-flare"));
console.log(
  JSON.stringify({
    presets: 24,
    dimensionsValid: true,
    automaticCombinations: true,
    legacySettings: true,
    fixedSizeModels: true,
    result: "passed",
  }),
);
