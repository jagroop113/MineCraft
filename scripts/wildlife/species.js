import * as THREE from "three";

/**
 * Animal species. Models are a few coloured boxes merged into one geometry
 * (one draw call per species via InstancedMesh). Parts are
 * [width, height, depth, x, y, z, colour] with the feet at y = 0, facing +z.
 *
 * Behaviour:
 * - habitat: "land" | "air" (birds) | "flutter" (insects near flowers) | "water" (fish) | "shore" (near water, can swim)
 * - speed / run: walking and fleeing speed (blocks per second)
 * - flee: distance at which the player scares it (0: not shy)
 * - group: [min, max] herd / flock size
 * - grazes / drinks: idle behaviours; sleeps: "night" | "day" | null
 * - hop: moves in hops (rabbits, frogs); flap: wings beat (birds, insects)
 */
export const SPECIES = {
  deer: {
    habitat: "land", speed: 2.2, run: 6, flee: 14, group: [2, 5], grazes: true, drinks: true, sleeps: "night", height: 1.9,
    parts: [
      [0.5, 0.55, 1.1, 0, 0.95, 0, 0x9a6a3c], [0.22, 0.5, 0.22, 0, 1.35, 0.45, 0x9a6a3c], [0.28, 0.28, 0.42, 0, 1.62, 0.62, 0x8a5c32],
      [0.5, 0.28, 0.06, 0, 1.92, 0.5, 0xd8c8a0], [0.14, 0.12, 0.1, 0, 1.05, -0.58, 0xf4efe6],
      ...legs(0.18, 0.38, 0.7, 0.12, 0x6e4a2a),
    ],
  },
  rabbit: {
    habitat: "land", speed: 1.6, run: 5.5, flee: 8, group: [1, 3], hop: true, grazes: true, sleeps: "night", height: 0.6,
    parts: [
      [0.3, 0.28, 0.45, 0, 0.22, 0, 0x9b8b7a], [0.24, 0.24, 0.24, 0, 0.38, 0.24, 0x9b8b7a],
      [0.06, 0.24, 0.05, 0.06, 0.6, 0.2, 0xb8a898], [0.06, 0.24, 0.05, -0.06, 0.6, 0.2, 0xb8a898], [0.12, 0.12, 0.08, 0, 0.26, -0.26, 0xf4f4f0],
    ],
  },
  fox: {
    habitat: "land", speed: 2, run: 5.5, flee: 10, group: [1, 2], drinks: true, sleeps: "day", height: 0.8,
    parts: [
      [0.32, 0.3, 0.75, 0, 0.42, 0, 0xd06a2a], [0.3, 0.28, 0.3, 0, 0.56, 0.46, 0xd06a2a], [0.14, 0.12, 0.18, 0, 0.5, 0.66, 0xf2e8dc],
      [0.08, 0.12, 0.05, 0.09, 0.74, 0.44, 0x3a2a20], [0.08, 0.12, 0.05, -0.09, 0.74, 0.44, 0x3a2a20],
      [0.18, 0.18, 0.5, 0, 0.45, -0.58, 0xd06a2a], [0.18, 0.18, 0.12, 0, 0.45, -0.86, 0xf4f0e8],
      ...legs(0.1, 0.26, 0.28, 0.08, 0x3a2a20),
    ],
  },
  wolf: {
    habitat: "land", speed: 2.2, run: 4.5, flee: 0, group: [3, 5], drinks: true, sleeps: null, height: 1,
    parts: [
      [0.42, 0.42, 0.95, 0, 0.62, 0, 0x8d8d8d], [0.36, 0.34, 0.36, 0, 0.8, 0.6, 0x9a9a9a], [0.18, 0.14, 0.22, 0, 0.72, 0.84, 0xb4b4b4],
      [0.08, 0.14, 0.06, 0.1, 1.02, 0.56, 0x6a6a6a], [0.08, 0.14, 0.06, -0.1, 1.02, 0.56, 0x6a6a6a], [0.14, 0.14, 0.45, 0, 0.66, -0.66, 0x7d7d7d],
      ...legs(0.14, 0.34, 0.42, 0.12, 0x7a7a7a),
    ],
  },
  bear: {
    habitat: "land", speed: 1.4, run: 3.5, flee: 0, group: [1, 1], drinks: true, sleeps: "night", height: 1.5,
    parts: [
      [0.9, 0.85, 1.5, 0, 0.95, 0, 0x5b3b22], [0.6, 0.55, 0.55, 0, 1.2, 0.95, 0x5b3b22], [0.3, 0.24, 0.22, 0, 1.12, 1.28, 0x8a6a4a],
      [0.14, 0.14, 0.08, 0.2, 1.52, 0.86, 0x4a2e1a], [0.14, 0.14, 0.08, -0.2, 1.52, 0.86, 0x4a2e1a],
      ...legs(0.3, 0.5, 0.55, 0.26, 0x4a2e1a),
    ],
  },
  sheep: {
    habitat: "land", speed: 1.2, run: 3.5, flee: 5, group: [2, 4], grazes: true, drinks: true, sleeps: "night", height: 1.3,
    parts: [
      [0.75, 0.65, 1.0, 0, 0.85, 0, 0xeeeeea], [0.35, 0.35, 0.4, 0, 1.05, 0.62, 0x3a3a3a], [0.42, 0.18, 0.3, 0, 1.25, 0.56, 0xeeeeea],
      ...legs(0.22, 0.32, 0.55, 0.14, 0x3a3a3a),
    ],
  },
  cow: {
    habitat: "land", speed: 1.1, run: 2.5, flee: 0, group: [2, 4], grazes: true, drinks: true, sleeps: "night", height: 1.6,
    parts: [
      [0.8, 0.75, 1.35, 0, 1.05, 0, 0x2a2a2a], [0.82, 0.42, 0.5, 0, 1.12, 0.22, 0xf0f0f0], [0.82, 0.3, 0.3, 0, 0.95, -0.4, 0xf0f0f0],
      [0.5, 0.5, 0.45, 0, 1.32, 0.86, 0x2a2a2a], [0.3, 0.2, 0.12, 0, 1.18, 1.12, 0xe8b4a8], [0.7, 0.08, 0.08, 0, 1.6, 0.86, 0xe6dccb],
      ...legs(0.26, 0.48, 0.68, 0.18, 0x2a2a2a),
    ],
  },
  pig: {
    habitat: "land", speed: 1.2, run: 3, flee: 0, group: [1, 3], grazes: true, sleeps: "night", height: 0.95,
    parts: [
      [0.7, 0.55, 1.0, 0, 0.62, 0, 0xf0a0a0], [0.5, 0.45, 0.4, 0, 0.74, 0.66, 0xf0a0a0], [0.24, 0.16, 0.08, 0, 0.66, 0.9, 0xd87e84],
      ...legs(0.22, 0.3, 0.35, 0.16, 0xe08e92),
    ],
  },
  chicken: {
    habitat: "land", speed: 1.3, run: 3, flee: 4, group: [2, 4], grazes: true, sleeps: "night", height: 0.85,
    parts: [
      [0.32, 0.3, 0.42, 0, 0.42, 0, 0xf6f6f2], [0.2, 0.26, 0.2, 0, 0.68, 0.18, 0xf6f6f2], [0.06, 0.1, 0.12, 0, 0.86, 0.18, 0xd8281e],
      [0.08, 0.06, 0.1, 0, 0.66, 0.32, 0xf0a020], [0.04, 0.28, 0.04, 0.08, 0.14, 0, 0xf0a020], [0.04, 0.28, 0.04, -0.08, 0.14, 0, 0xf0a020],
    ],
  },
  horse: {
    habitat: "land", speed: 2.5, run: 7, flee: 8, group: [2, 4], grazes: true, drinks: true, sleeps: "night", height: 2.3,
    parts: [
      [0.55, 0.65, 1.4, 0, 1.3, 0, 0x8a5a32], [0.3, 0.7, 0.35, 0, 1.78, 0.62, 0x8a5a32], [0.3, 0.32, 0.62, 0, 2.08, 0.9, 0x7a4e2a],
      [0.08, 0.6, 0.3, 0, 1.92, 0.5, 0x2a1a10], [0.12, 0.6, 0.12, 0, 1.2, -0.76, 0x2a1a10],
      ...legs(0.18, 0.5, 1.0, 0.14, 0x6e4626),
    ],
  },
  bird: {
    habitat: "air", speed: 6, run: 9, flee: 0, group: [3, 6], flap: true, sleeps: "night", height: 0.3,
    parts: [
      [0.18, 0.16, 0.32, 0, 0, 0, 0x3f6fbf], [0.72, 0.03, 0.2, 0, 0.04, 0, 0x2c4f8f], [0.05, 0.05, 0.1, 0, 0.02, 0.2, 0xf0b020], [0.14, 0.02, 0.14, 0, 0.02, -0.2, 0x2c4f8f],
    ],
  },
  butterfly: {
    habitat: "flutter", speed: 1.2, run: 2, flee: 0, group: [1, 2], flap: true, sleeps: "night", height: 0.2,
    parts: [[0.03, 0.03, 0.18, 0, 0, 0, 0x222222], [0.38, 0.01, 0.24, 0, 0, 0, 0xf2a33a], [0.3, 0.012, 0.1, 0, 0, -0.08, 0x2a2a2a]],
  },
  bee: {
    habitat: "flutter", speed: 2, run: 3, flee: 0, group: [1, 3], flap: true, sleeps: "night", height: 0.2,
    parts: [[0.12, 0.12, 0.22, 0, 0, 0, 0xf2c52a], [0.13, 0.13, 0.05, 0, 0, -0.03, 0x222222], [0.24, 0.01, 0.1, 0, 0.07, 0, 0xe8f0ff]],
  },
  fish: {
    habitat: "water", speed: 1.4, run: 4, flee: 4, group: [3, 5], sleeps: null, height: 0.2,
    parts: [[0.1, 0.16, 0.34, 0, 0, 0, 0xff8c3a], [0.02, 0.16, 0.14, 0, 0, -0.22, 0xf06a20], [0.11, 0.04, 0.06, 0, 0.04, 0.12, 0x222222]],
  },
  frog: {
    habitat: "shore", speed: 1, run: 3, flee: 3, group: [1, 2], hop: true, sleeps: null, height: 0.3,
    parts: [
      [0.28, 0.16, 0.3, 0, 0.1, 0, 0x4e9a3a], [0.06, 0.06, 0.06, 0.08, 0.2, 0.1, 0xf0e050], [0.06, 0.06, 0.06, -0.08, 0.2, 0.1, 0xf0e050],
      [0.08, 0.06, 0.18, 0.16, 0.04, -0.06, 0x3e7a2a], [0.08, 0.06, 0.18, -0.16, 0.04, -0.06, 0x3e7a2a],
    ],
  },
  turtle: {
    habitat: "shore", speed: 0.5, run: 0.8, flee: 0, group: [1, 2], sleeps: null, height: 0.4,
    parts: [
      [0.55, 0.25, 0.65, 0, 0.22, 0, 0x3f6b2a], [0.18, 0.14, 0.24, 0, 0.18, 0.42, 0x8fae6a],
      ...legs(0.24, 0.24, 0.12, 0.1, 0x8fae6a),
    ],
  },
};

// Four legs: half-spacing x / z, length, thickness
function legs(x, z, length, thickness, color) {
  return [
    [thickness, length, thickness, x, length / 2, z, color],
    [thickness, length, thickness, -x, length / 2, z, color],
    [thickness, length, thickness, x, length / 2, -z, color],
    [thickness, length, thickness, -x, length / 2, -z, color],
  ];
}

/** Merges a species' boxes into one vertex-coloured geometry */
export function buildModel(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  for (const [w, h, d, x, y, z, hex] of parts) {
    const box = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    color.setHex(hex, THREE.SRGBColorSpace);
    const offset = positions.length / 3;
    positions.push(...box.attributes.position.array);
    normals.push(...box.attributes.normal.array);
    for (let i = 0; i < box.attributes.position.count; i++) colors.push(color.r, color.g, color.b);
    indices.push(...Array.from(box.index.array, (i) => i + offset));
    box.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}
