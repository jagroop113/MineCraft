import * as THREE from "three";
import { RNG } from "./rgs";

//! 16x16 pixel-art textures for blocks that have no image in public/textures.
//! Each painter returns a canvas (or null outside the browser, e.g. unit tests).

const SIZE = 16;

function paintCanvas(seed, paint) {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const rng = new RNG(seed);

  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const color = paint(x, y, rng);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

/** Wraps a painted canvas in a pixel-art texture (an empty texture outside the browser) */
export function canvasTexture(canvas) {
  if (!canvas) return new THREE.Texture();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

// Varies the lightness of a base colour a little per pixel
function shade(rgb, rng, amount, offset = 0) {
  const k = 1 + offset + (rng.random() - 0.5) * amount;
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * k))));
  return `rgb(${r},${g},${b})`;
}

function planks(seed, rgb) {
  return paintCanvas(seed, (x, y, rng) => {
    const row = Math.floor(y / 4);
    const seam = row % 2 === 0 ? 3 : 11;
    if (y % 4 === 3) return shade(rgb, rng, 0.1, -0.35);
    if (x === seam) return shade(rgb, rng, 0.1, -0.25);
    // Faint horizontal grain
    const grain = (x + row * 5) % 7 === 0 ? -0.08 : 0;
    return shade(rgb, rng, 0.12, grain);
  });
}

function bark(seed, rgb, streak) {
  return paintCanvas(seed, (x, y, rng) => {
    const isStreak = (x * 7 + Math.floor(y / 3)) % 5 === 0;
    return shade(isStreak ? streak : rgb, rng, 0.18);
  });
}

function logTop(seed, bark, wood) {
  return paintCanvas(seed, (x, y, rng) => {
    const edge = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
    if (edge) return shade(bark, rng, 0.15);
    const ring = Math.floor(Math.hypot(x - 7.5, y - 7.5)) % 3 === 0;
    return shade(wood, rng, 0.1, ring ? -0.18 : 0);
  });
}

/** Leaves: coloured clumps with see-through gaps (rendered with alphaTest) */
function leaves(seed, colors, gaps = 0.18) {
  return paintCanvas(seed, (x, y, rng) => {
    if (rng.random() < gaps) return null;
    const color = colors[Math.floor(rng.random() * colors.length)];
    return shade(color, rng, 0.2);
  });
}

/** A plant sprite drawn bottom-up: stem function + head function on a clear background */
function plant(seed, paint) {
  return paintCanvas(seed, (x, y, rng) => paint(x, SIZE - 1 - y, rng));
}

function flower(seed, petal, centre) {
  return plant(seed, (x, y, rng) => {
    if (x === 7 && y < 9) return shade([60, 130, 40], rng, 0.2);
    if ((x === 6 && y === 4) || (x === 8 && y === 6)) return shade([70, 140, 45], rng, 0.2);
    const d = Math.hypot(x - 7, y - 10.5);
    if (d < 1) return shade(centre, rng, 0.1);
    if (d < 2.6) return shade(petal, rng, 0.15);
    return null;
  });
}

function mushroom(seed, cap, spots) {
  return plant(seed, (x, y, rng) => {
    if (x >= 7 && x <= 8 && y < 5) return shade([225, 215, 195], rng, 0.1);
    if (y >= 5 && y <= 8 && Math.abs(x - 7.5) <= 4.5 - (y - 5) * 0.6) {
      return spots && rng.random() < 0.18 ? "rgb(245,245,240)" : shade(cap, rng, 0.15);
    }
    return null;
  });
}

export const PROCEDURAL_PAINTERS = {
  planks: () => planks(7, [184, 148, 95]),
  brick: () =>
    paintCanvas(8, (x, y, rng) => {
      const row = Math.floor(y / 4);
      const seamOffset = row % 2 === 0 ? 3 : 7;
      const isMortar = y % 4 === 3 || (x - seamOffset + 16) % 8 === 0;
      if (isMortar) return shade([196, 188, 172], rng, 0.1);
      return shade([150, 70, 52], rng, 0.18);
    }),
  glass: () =>
    paintCanvas(10, (x, y) => {
      const isFrame = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
      if (isFrame) return "rgb(205,232,240)";
      // Two diagonal glints, everything else fully see-through
      const isGlint = (x + y === 6 && x > 1 && x < 5) || (x + y === 18 && x > 9 && x < 14);
      if (isGlint) return "rgb(240,250,255)";
      return null;
    }),
  water: () =>
    paintCanvas(12, (x, y, rng) => {
      const wave = Math.sin((x + y * 0.5) * 0.9) * 0.08;
      return shade([48, 96, 210], rng, 0.12, wave);
    }),
  cobblestone: () =>
    paintCanvas(13, (x, y, rng) => {
      // Irregular stones: darker cracks along a jittered grid
      const cellX = (x + (Math.floor(y / 5) % 2) * 3) % 6;
      const isCrack = cellX === 0 || y % 5 === 0 || rng.random() < 0.06;
      if (isCrack) return shade([78, 78, 78], rng, 0.15);
      return shade([132, 132, 132], rng, 0.25);
    }),
  mossyCobblestone: () =>
    paintCanvas(14, (x, y, rng) => {
      const cellX = (x + (Math.floor(y / 5) % 2) * 3) % 6;
      const isCrack = cellX === 0 || y % 5 === 0;
      if (isCrack) return shade([70, 76, 66], rng, 0.15);
      const moss = Math.sin(x * 0.9 + y * 0.4) + Math.cos(y * 0.7 - x * 0.3) > 0.6;
      return moss ? shade([84, 120, 52], rng, 0.25) : shade([128, 128, 124], rng, 0.25);
    }),
  gravel: () =>
    paintCanvas(15, (x, y, rng) => {
      const r = rng.random();
      if (r < 0.3) return shade([95, 88, 84], rng, 0.2);
      if (r < 0.55) return shade([150, 140, 132], rng, 0.2);
      return shade([122, 114, 108], rng, 0.2);
    }),
  birchSide: () =>
    paintCanvas(16, (x, y, rng) => {
      const mark = (Math.floor(y / 3) * 5 + Math.floor(x / 4) * 3) % 7 === 0 && rng.random() < 0.85;
      return mark ? shade([45, 42, 38], rng, 0.2) : shade([222, 220, 210], rng, 0.08);
    }),
  birchTop: () => logTop(17, [210, 208, 196], [200, 178, 128]),
  birchLeaves: () => leaves(18, [[118, 160, 72], [132, 176, 80], [100, 142, 60]]),
  cherrySide: () => bark(19, [84, 46, 50], [58, 30, 36]),
  cherryTop: () => logTop(20, [84, 46, 50], [214, 166, 160]),
  cherryLeaves: () => leaves(21, [[238, 156, 196], [246, 186, 214], [226, 128, 178], [250, 214, 230]], 0.14),
  pineSide: () => bark(22, [74, 52, 34], [52, 36, 24]),
  pineTop: () => logTop(23, [74, 52, 34], [170, 128, 84]),
  pineLeaves: () => leaves(24, [[44, 82, 56], [36, 70, 48], [54, 96, 64]], 0.16),
  tallGrass: () =>
    plant(25, (x, y, rng) => {
      const blade = [2, 5, 7, 10, 13].some((b, i) => x === b && y < 6 + ((i * 5) % 7) + 3);
      return blade ? shade([92, 150, 58], rng, 0.25) : null;
    }),
  fern: () =>
    plant(26, (x, y, rng) => {
      const d = Math.abs(x - 7.5);
      if (y > 1 && y < 13 && d < (13 - y) * 0.55 && (x + y) % 2 === 0) return shade([62, 120, 50], rng, 0.25);
      return null;
    }),
  poppy: () => flower(27, [210, 40, 36], [40, 30, 20]),
  dandelion: () => flower(28, [246, 214, 40], [220, 160, 20]),
  cornflower: () => flower(29, [80, 110, 230], [40, 50, 120]),
  pinkTulip: () => flower(30, [244, 150, 196], [255, 230, 120]),
  redMushroom: () => mushroom(31, [200, 36, 30], true),
  brownMushroom: () => mushroom(32, [150, 108, 76], false),
  deadBush: () =>
    plant(33, (x, y, rng) => {
      const branch = (x === 7 && y < 10) || (x - 7 === y - 6 && y > 5 && y < 12) || (7 - x === y - 4 && y > 3 && y < 10);
      return branch ? shade([126, 88, 46], rng, 0.2) : null;
    }),
};

/** Paints a magenta/black checker (for textures that fail to load) into ctx at (x, y) */
export function paintMissing(ctx, x = 0, y = 0, size = 2) {
  ctx.fillStyle = "#f0f";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#000";
  ctx.fillRect(x, y, size / 2, size / 2);
  ctx.fillRect(x + size / 2, y + size / 2, size / 2, size / 2);
}

/** Replaces a failed texture's image with the missing-texture checker */
export function paintMissingTexture(texture) {
  if (typeof document === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  paintMissing(canvas.getContext("2d"));
  texture.image = canvas;
  texture.needsUpdate = true;
}
