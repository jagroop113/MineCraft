import { createGenerator } from "./generators";

//! Generates chunk block data off the main thread; the main thread only builds meshes

let current = { key: null, generator: null };

self.onmessage = ({ data }) => {
  const { jobId, chunkX, chunkZ, params, size, resources } = data;
  try {
    const key = JSON.stringify([params, size, resources]);
    if (current.key !== key) current = { key, generator: createGenerator(params, size, resources) };
    const { blocks, features } = current.generator.generateChunk(chunkX, chunkZ);
    self.postMessage({ jobId, blocks, features }, [blocks.buffer]);
  } catch (error) {
    self.postMessage({ jobId, error: error.message });
  }
};
