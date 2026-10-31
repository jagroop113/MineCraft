import * as THREE from "three";
import { blocks, getBlockType, isBreakable, isPlaceable, isReplaceable } from "../blocks";
import { createRaycastHit, raycastBlocks } from "./voxelRaycast";

const SCREEN_CENTER = new THREE.Vector2(0, 0);

const highlightGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
const highlightMaterial = new THREE.LineBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.7,
});
// Slightly smaller than a block so the preview never z-fights with neighbours
const previewGeometry = new THREE.BoxGeometry(0.96, 0.96, 0.96);

/**
 * Finds the block under the crosshair, outlines it and shows a translucent
 * preview of the selected block where it would be placed. Also owns the
 * placement / removal validation rules.
 */
export class BlockTargeting {
  /** Maximum reach in blocks */
  reach = 6;
  /** Blocks at or below this height can't be removed (the base layer) */
  protectedHeight = 0;

  /** @type {import("./voxelRaycast").RaycastHit | null} */
  target = null;
  /** Empty cell next to the targeted face, or null if nothing can go there */
  placement = null;

  #raycaster = new THREE.Raycaster();
  #hit = createRaycastHit();
  #cell = new THREE.Vector3();
  #previewMaterials = new Map();

  constructor(scene, world, player) {
    this.scene = scene;
    this.world = world;
    this.player = player;

    this.highlight = new THREE.LineSegments(highlightGeometry, highlightMaterial);
    this.highlight.visible = false;

    this.preview = new THREE.Mesh(previewGeometry);
    this.preview.visible = false;
    this.preview.renderOrder = 1;

    scene.add(this.highlight, this.preview);
  }

  /**
   * @param {number | null} selectedBlockId block to preview, null hides targeting entirely
   */
  update(selectedBlockId) {
    this.target = null;
    this.placement = null;

    if (selectedBlockId !== null) {
      const camera = this.player.camera;
      camera.updateMatrixWorld();
      this.#raycaster.setFromCamera(SCREEN_CENTER, camera);
      this.target = raycastBlocks(this.world, this.#raycaster.ray, this.reach, this.#hit);

      if (this.target) {
        const cell = this.getAdjacentCell(this.target);
        if (this.getPlaceError(cell, selectedBlockId) === null) this.placement = cell;
      }
    }

    this.highlight.visible = this.target !== null;
    if (this.target) this.highlight.position.copy(this.target.position);

    this.preview.visible = this.placement !== null;
    if (this.placement) {
      this.preview.position.copy(this.placement);
      this.preview.material = this.#getPreviewMaterial(selectedBlockId);
    }
  }

  /**
   * The grid cell a new block goes into: the hit block offset by the face normal,
   * or the hit cell itself when it holds a replaceable plant
   */
  getAdjacentCell(hit) {
    if (isReplaceable(hit.block.id)) return this.#cell.copy(hit.position);
    return this.#cell.copy(hit.position).add(hit.normal);
  }

  /** @returns {string | null} why blockId can't be placed at cell, or null if it can */
  getPlaceError(cell, blockId) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !Number.isInteger(cell.z)) {
      return "Blocks must be placed on the grid";
    }
    if (!isPlaceable(blockId)) return "That block can't be placed";
    const block = this.world.getBlock(cell.x, cell.y, cell.z);
    if (!block) return "Outside the world";
    if (!isReplaceable(block.id)) return "Space is occupied";
    const distance = this.player.position.distanceTo(cell);
    if (distance > this.reach + 1) return "Too far away";
    if (getBlockType(blockId).solid !== false && this.intersectsPlayer(cell)) return "You're in the way";
    return null;
  }

  /** @returns {string | null} why the block at position can't be removed, or null if it can */
  getRemoveError(position) {
    if (!position) return "No block in reach";
    const block = this.world.getBlock(position.x, position.y, position.z);
    if (!block || block.id === blocks.empty.id) return "No block there";
    if (position.y <= this.protectedHeight) return "The base layer is unbreakable";
    if (!isBreakable(block.id)) return "That block is unbreakable";
    return null;
  }

  /** The player is a vertical cylinder whose top is at the camera (eye) position */
  intersectsPlayer(cell) {
    const p = this.player.position;
    const overlapsY = cell.y + 0.5 > p.y - this.player.height && cell.y - 0.5 < p.y;
    if (!overlapsY) return false;

    const dx = Math.max(cell.x - 0.5 - p.x, 0, p.x - (cell.x + 0.5));
    const dz = Math.max(cell.z - 0.5 - p.z, 0, p.z - (cell.z + 0.5));
    return dx * dx + dz * dz < this.player.radius * this.player.radius;
  }

  dispose() {
    this.scene.remove(this.highlight, this.preview);
    for (const material of this.#previewMaterials.values()) {
      [material].flat().forEach((m) => m.dispose());
    }
    this.#previewMaterials.clear();
  }

  // One translucent copy of each block's material(s), created on first use
  #getPreviewMaterial(blockId) {
    if (!this.#previewMaterials.has(blockId)) {
      const toPreview = (material) => {
        const preview = material.clone();
        preview.transparent = true;
        preview.opacity = 0.45;
        preview.depthWrite = false;
        return preview;
      };
      const material = getBlockType(blockId).material;
      this.#previewMaterials.set(
        blockId,
        Array.isArray(material) ? material.map(toPreview) : toPreview(material)
      );
    }
    return this.#previewMaterials.get(blockId);
  }
}
