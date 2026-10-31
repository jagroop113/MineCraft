import { resources } from "../blocks";
import { createClassicGenerator } from "./classicGenerator";
import { createNaturalGenerator } from "./naturalGenerator";

/** Ore settings the classic generator reads (editable in the debug GUI) */
export function snapshotResources() {
  return resources.map((r) => ({ id: r.id, scale: { ...r.scale }, scarcity: r.scarcity }));
}

/**
 * Terrain generator for world params. "natural" is the biome generator;
 * "classic" (and older saves without a generator) is the original heightmap.
 */
export function createGenerator(params, size, resourceConfig = snapshotResources()) {
  return params.generator === "natural"
    ? createNaturalGenerator(params, size)
    : createClassicGenerator(params, size, resourceConfig);
}

let cached = { key: null, generator: null };

/** Same as createGenerator, reusing the last instance while settings are unchanged */
export function getGenerator(params, size) {
  const resourceConfig = snapshotResources();
  const key = JSON.stringify([params, size.width, size.height, resourceConfig]);
  if (cached.key !== key) cached = { key, generator: createGenerator(params, size, resourceConfig) };
  return cached.generator;
}
