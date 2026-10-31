import * as THREE from "three";
import { texturesLoaded } from "../../blocks";

export const ICON_SIZE = 48;

// Isometric cube faces as 2D transforms: [origin, u axis, v axis] in icon pixels
const FACES = {
  top: { origin: [24, 3], u: [20, 10], v: [-20, 10], shade: 0 },
  left: { origin: [4, 13], u: [20, 10], v: [0, 22], shade: 0.25 },
  right: { origin: [24, 23], u: [20, -10], v: [0, 22], shade: 0.42 },
};

const canvases = new Map();

function faceTextures(material) {
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  if (Array.isArray(material)) return { top: material[2], side: material[4] };
  return { top: material, side: material };
}

function drawFace(ctx, face, material, fallbackColor) {
  const image = material.map?.image;
  ctx.save();
  ctx.globalAlpha = material.transparent ? material.opacity : 1;

  if (image?.width) {
    const k = 1 / image.width;
    ctx.setTransform(face.u[0] * k, face.u[1] * k, face.v[0] * k, face.v[1] * k, ...face.origin);
    ctx.drawImage(image, 0, 0);
  } else {
    ctx.setTransform(face.u[0], face.u[1], face.v[0], face.v[1], ...face.origin);
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(0, 0, 1, 1);
  }

  // Darken only the pixels this face drew, so see-through texels stay clear
  if (face.shade > 0) {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = `rgba(0,0,0,${face.shade})`;
    ctx.fillRect(0, 0, image?.width ?? 1, image?.height ?? 1);
  }
  ctx.restore();
}

function drawIcon(canvas, blockType) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);

  // Plants are flat sprites, so show them flat
  if (blockType.shape === "cross") {
    const image = blockType.material.map?.image;
    if (image?.width) ctx.drawImage(image, 6, 6, ICON_SIZE - 12, ICON_SIZE - 12);
    return;
  }

  const { top, side } = faceTextures(blockType.material);
  const fallbackColor = `#${new THREE.Color(blockType.color).getHexString()}`;
  // Draw each face onto its own layer so "source-atop" shading stays per face
  for (const [name, material] of [["left", side], ["right", side], ["top", top]]) {
    const layer = document.createElement("canvas");
    layer.width = layer.height = ICON_SIZE;
    const layerCtx = layer.getContext("2d");
    layerCtx.imageSmoothingEnabled = false;
    drawFace(layerCtx, FACES[name], material, fallbackColor);
    ctx.drawImage(layer, 0, 0);
  }
}

/** Creates a canvas with an isometric icon of the block, redrawn once textures load */
export function createBlockIcon(blockType) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_SIZE;
  canvas.className = "block-icon";
  updateBlockIcon(canvas, blockType);
  return canvas;
}

export function updateBlockIcon(canvas, blockType) {
  canvases.set(canvas, blockType);
  drawIcon(canvas, blockType);
}

texturesLoaded.then(() => {
  canvases.forEach((blockType, canvas) => drawIcon(canvas, blockType));
});
