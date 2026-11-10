import {
  REASONING_PARTICLES,
  energyFor,
  fillBackgroundFor,
  speedFor,
  starBrightnessFor,
  starCountFor,
  starDelayFor,
  starDurationFor,
  starLayerOpacityFor,
} from "../app/utils/reasoning-effort-motion";

// These fixtures were evaluated from the upstream lib/client.js pure functions.
test.each([
  [0, 0, 0, 0.35, 0.6],
  [0.2, 0, 0, 0.35, 0.6],
  [0.4, 0.1, 2, 0.35, 0.64],
  [0.6, 0.4, 9, 0.8, 0.76],
  [0.8, 0.7, 15, 1.4, 0.88],
  [1, 1, 22, 2, 1],
] as const)(
  "position %s matches upstream energy, density, speed and independent star opacity",
  (position, energy, count, speed, opacity) => {
    expect(energyFor(position)).toBeCloseTo(energy, 12);
    expect(starCountFor(position)).toBe(count);
    expect(speedFor(position)).toBeCloseTo(speed, 12);
    expect(starLayerOpacityFor(position)).toBeCloseTo(opacity, 12);
  },
);

test("the starfield keeps its graphite origin while shifting the lit edge from blue to violet", () => {
  expect(fillBackgroundFor(0)).toBe(
    "linear-gradient(90deg, #26292e 0%, #30343a 15%, hsl(198 38% 47%) 45%, hsl(210 79% 70%) 78%, hsl(215 88% 70%) 100%)",
  );
  expect(fillBackgroundFor(1)).toBe(
    "linear-gradient(90deg, #26292e 0%, #30343a 15%, hsl(261 38% 47%) 45%, hsl(273 79% 70%) 78%, hsl(278 88% 70%) 100%)",
  );
});

test("the original two-thirds anchor keeps half energy, eleven stars and relative speed after threefold acceleration", () => {
  const position = 2 / 3;
  expect(energyFor(position)).toBeCloseTo(0.5, 12);
  expect(starCountFor(position)).toBe(11);
  expect(speedFor(position)).toBe(1);
  expect(starDurationFor(0, 1)).toBeCloseTo(starDurationFor(0, 2) * 2, 12);
  expect(starLayerOpacityFor(position)).toBeCloseTo(0.8, 12);
});

test("the deterministic twenty-two-star distribution preserves the upstream golden phases", () => {
  expect(REASONING_PARTICLES).toHaveLength(22);
  expect(REASONING_PARTICLES.slice(0, 4)).toEqual([
    { y: 52, phase: 0.6180339887498949 },
    { y: 84, phase: 0.2360679774997898 },
    { y: 64, phase: 0.8541019662496847 },
    { y: 16, phase: 0.4721359549995796 },
  ]);
  expect(new Set(REASONING_PARTICLES.map((particle) => particle.y)).size).toBe(
    22,
  );
  const byPhase = [...REASONING_PARTICLES].sort((a, b) => a.phase - b.phase);
  for (let index = 1; index < byPhase.length; index++) {
    expect(
      Math.abs(byPhase[index].y - byPhase[index - 1].y),
    ).toBeGreaterThanOrEqual(12);
  }
});

test.each([
  [0, 0.6395, 1.41096, -0.8822224775665517],
  [1, 0.671, 1.39008, -0.3392879149629078],
  [21, 0.9505, 1.50456, -0.9366604464979212],
] as const)(
  "star %s retains source brightness and phase at three times the upstream animation speed",
  (index, brightness, sourceDuration, sourceDelay) => {
    const duration = sourceDuration / 3;
    expect(starBrightnessFor(index)).toBeCloseTo(brightness, 12);
    expect(starDurationFor(index, 2)).toBeCloseTo(duration, 12);
    expect(starDelayFor(index, duration)).toBeCloseTo(sourceDelay / 3, 12);
  },
);

test("changing speed preserves the same indexed phase instead of redistributing stars", () => {
  for (let index = 0; index < REASONING_PARTICLES.length; index++) {
    const fastest = starDurationFor(index, 2);
    const slower = starDurationFor(index, 0.8);
    expect(starDelayFor(index, fastest) / fastest).toBeCloseTo(
      starDelayFor(index, slower) / slower,
      12,
    );
    expect(starDelayFor(index, fastest)).toBeLessThan(0);
    expect(starBrightnessFor(index)).toBeGreaterThanOrEqual(0.5);
    expect(starBrightnessFor(index)).toBeLessThanOrEqual(1);
    expect(fastest).toBeGreaterThanOrEqual(0.5 * 0.92);
    expect(fastest).toBeLessThanOrEqual(0.5 * 1.08);
  }
});

test("out-of-range positions clamp without inventing additional energy", () => {
  expect(energyFor(-1)).toBe(0);
  expect(energyFor(Number.NaN)).toBe(0);
  expect(starCountFor(2)).toBe(22);
  expect(fillBackgroundFor(-1)).toBe(fillBackgroundFor(0));
  expect(fillBackgroundFor(Number.NaN)).toBe(fillBackgroundFor(0));
  expect(fillBackgroundFor(2)).toBe(fillBackgroundFor(1));
  expect(speedFor(2)).toBe(2);
});
