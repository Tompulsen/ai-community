// Adapted from Microqian2th/dsh-codex-effort-slider, lib/client.js (MIT).
// Copyright (c) 2026 dsh-codex-effort-slider contributors.
// Full license: THIRD_PARTY_NOTICES.md.
const GOLDEN_RATIO = 0.6180339887498949;
const ENERGY_START = 1 / 3;
const STARFIELD_MIN = 0.5;
const STARFIELD_DURATION_MEAN = 1.5;
// Preserve the upstream timing and phase while scaling playback speed.
const STARFIELD_SPEEDUP = 3;
const STARFIELD_DURATION_SPREAD = 0.08;
const MAX_SPEED_FACTOR = 2;
const MIN_HEIGHT_SLOTS = 3;

function clamp01(value: number) {
  if (!(value > 0)) return 0;
  return value > 1 ? 1 : value;
}

function starHash01(index: number, salt: number) {
  const value = ((index + 1) * salt * 2654435761) % 4294967296;
  return ((value >>> 8) % 1000) / 1000;
}

export const REASONING_PARTICLES = (() => {
  const count = 22;
  const out = Array.from({ length: count }, (_, index) => ({
    y: 0,
    phase: ((index + 1) * GOLDEN_RATIO) % 1,
  }));
  const byPhase = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => out[a].phase - out[b].phase,
  );
  let slots: number[] | null = null;
  for (let salt = 71; salt < 4000 && slots === null; salt++) {
    const candidate = Array.from({ length: count }, (_, index) => index).sort(
      (a, b) => {
        const ha = starHash01(a, salt);
        const hb = starHash01(b, salt);
        return ha === hb ? a - b : ha - hb;
      },
    );
    if (
      candidate.every(
        (slot, index) =>
          index === 0 ||
          Math.abs(slot - candidate[index - 1]) >= MIN_HEIGHT_SLOTS,
      )
    )
      slots = candidate;
  }
  slots ??= Array.from({ length: count }, (_, index) => (index * 5) % count);
  for (let rank = 0; rank < count; rank++) {
    out[byPhase[rank]].y = 8 + (slots[rank] / (count - 1)) * 84;
  }
  return out;
})();

// Starfield palette: LeiBox reasoning-effort-slider; see THIRD_PARTY_NOTICES.md.
export function fillBackgroundFor(position: number) {
  const hue = 210 + clamp01(position) ** 2 * 63;
  return `linear-gradient(90deg, #26292e 0%, #30343a 15%, hsl(${
    hue - 12
  } 38% 47%) 45%, hsl(${hue} 79% 70%) 78%, hsl(${hue + 5} 88% 70%) 100%)`;
}

// Adapted from LeiBox's createEffortField; motion stays with the existing CSS layers.
export function drawEffortBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  position: number,
) {
  if (!(width > 0 && height > 0)) return;
  const ratio = clamp01(position);
  const hue = 210 + ratio * ratio * 63;
  const fill = height + (width - height) * ratio;
  ctx.clearRect(0, 0, width, height);
  const base = ctx.createLinearGradient(0, 0, Math.max(fill, 32), 0);
  base.addColorStop(0, "#30343a");
  base.addColorStop(0.28, `hsl(${hue - 12} 38% 47%)`);
  base.addColorStop(0.65, `hsl(${hue} 79% 70%)`);
  base.addColorStop(1, `hsl(${hue + 5} 88% 70%)`);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let band = 0; band < 7; band++) {
    ctx.beginPath();
    for (let x = 0; x <= width + 4; x += 4) {
      const y =
        height * (0.12 + band * 0.15) +
        Math.sin(x * 0.034 + band * 1.8) * 5 +
        Math.sin(x * 0.079 + band) * 2 -
        x * 0.035;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2 + (band % 3) * 2;
    ctx.strokeStyle = `hsla(${hue + band * 2} 90% 87% / ${
      0.06 + ratio * 0.025
    })`;
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(
    fill * 0.6,
    height * 0.7,
    0,
    fill * 0.6,
    height * 0.7,
    46,
  );
  glow.addColorStop(0, `hsla(${hue - 12} 100% 88% / .35)`);
  glow.addColorStop(1, `hsla(${hue} 100% 80% / 0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  const shade = ctx.createLinearGradient(0, 0, Math.max(fill, 32), 0);
  shade.addColorStop(0, "rgba(36,39,44,.8)");
  shade.addColorStop(0.45, "rgba(36,39,44,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
}

export function energyFor(position: number) {
  return clamp01((clamp01(position) - ENERGY_START) / (1 - ENERGY_START));
}

export function speedFor(position: number) {
  return Math.min(2, Math.max(0.35, 3 * clamp01(position) - 1));
}

export function starCountFor(position: number) {
  return Math.round(energyFor(position) * REASONING_PARTICLES.length);
}

export function starBrightnessFor(index: number) {
  return STARFIELD_MIN + (1 - STARFIELD_MIN) * starHash01(index, 61);
}

export function starDurationFor(index: number, speedFactor: number) {
  const speed = Math.min(
    MAX_SPEED_FACTOR,
    Math.max(
      0.35,
      typeof speedFactor === "number" ? speedFactor : MAX_SPEED_FACTOR,
    ),
  );
  const spread =
    1 -
    STARFIELD_DURATION_SPREAD +
    2 * STARFIELD_DURATION_SPREAD * starHash01(index, 29);
  return (
    ((STARFIELD_DURATION_MEAN * MAX_SPEED_FACTOR) /
      (speed * STARFIELD_SPEEDUP)) *
    spread
  );
}

export function starDelayFor(index: number, duration: number) {
  const phase = REASONING_PARTICLES[index]?.phase ?? 0;
  const jitter = starHash01(index, 53) * 0.03;
  return -((phase + jitter) % 1) * duration;
}

export function starLayerOpacityFor(position: number) {
  return 0.6 + 0.4 * energyFor(position);
}
