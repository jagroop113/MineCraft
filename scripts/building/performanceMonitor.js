const SAMPLE_SECONDS = 0.5;

/**
 * Measures frame rate and renderer load. Samples are aggregated every half
 * second so the overlay itself costs next to nothing.
 */
export class PerformanceMonitor {
  /** Latest aggregated sample */
  stats = { fps: 0, frameMs: 0, worstFrameMs: 0, drawCalls: 0, triangles: 0, faces: 0, heapMb: null };
  visible = false;
  /** Called with each aggregated sample (e.g. for adaptive resolution) */
  onSample = null;

  #frames = 0;
  #elapsed = 0;
  #worst = 0;

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {import("../world").World} world
   * @param {HTMLElement} [element] where to show the numbers
   */
  constructor(renderer, world, element) {
    this.renderer = renderer;
    this.world = world;
    this.element = element;
  }

  /** Call once per frame, after rendering */
  update(dt) {
    this.#frames++;
    this.#elapsed += dt;
    this.#worst = Math.max(this.#worst, dt);
    if (this.#elapsed < SAMPLE_SECONDS) return;

    const info = this.renderer.info.render;
    this.stats = {
      fps: Math.round(this.#frames / this.#elapsed),
      frameMs: +((this.#elapsed / this.#frames) * 1000).toFixed(1),
      worstFrameMs: +(this.#worst * 1000).toFixed(1),
      drawCalls: info.calls,
      triangles: info.triangles,
      faces: this.#countVisibleFaces(),
      heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    };
    this.#frames = 0;
    this.#elapsed = 0;
    this.#worst = 0;

    this.onSample?.(this.stats);
    if (this.visible && this.element) this.#render();
  }

  setVisible(visible) {
    this.visible = visible;
    if (this.element) {
      this.element.hidden = !visible;
      if (visible) this.#render();
    }
  }

  #countVisibleFaces() {
    let count = 0;
    for (const chunk of this.world.children) {
      for (const mesh of Object.values(chunk.meshes ?? {})) count += mesh.count;
    }
    return count;
  }

  #render() {
    const s = this.stats;
    const lines = [
      `${s.fps} FPS · ${s.frameMs} ms (worst ${s.worstFrameMs})`,
      `${s.drawCalls} draw calls · ${(s.triangles / 1000).toFixed(0)}k tris`,
      `${s.faces.toLocaleString()} visible block faces · ${this.world.loadedChunkCount ?? "?"} chunks`,
    ];
    if (s.heapMb !== null) lines.push(`${s.heapMb} MB JS heap`);
    this.element.textContent = lines.join("\n");
  }
}
