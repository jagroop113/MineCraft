import * as THREE from 'three'
import { PROCEDURAL_PAINTERS, canvasTexture, paintMissing, paintMissingTexture } from './proceduralTextures'


const isBrowser = typeof document !== 'undefined';
const loadingManager = new THREE.LoadingManager();
const textureLoader=new THREE.TextureLoader(loadingManager);
const failedTextures = [];

/**
 * Resolves once every image texture has loaded or failed.
 * The value is the list of texture paths that failed (shown as a checker pattern).
 */
export const texturesLoaded = isBrowser
  ? new Promise((resolve) => {
      loadingManager.onLoad = () => resolve(failedTextures);
    })
  : Promise.resolve(failedTextures);

// Every texture a block face can use: an image in public/ or a procedural painter
const TEXTURE_SOURCES = {
    dirt:'textures/dirt.png',
    stone:'textures/stone.png',
    grass:'textures/grass.png',
    grass_side:'textures/grass_side.png',
    coalOre:'textures/coal_ore.png',
    ironOre:'textures/iron_ore.png',
    treeSide:'textures/tree_side.png',
    treeTop:'textures/tree_top.png',
    leaves:'textures/leaves.png',
    sand:'textures/sand.png',
    snow:'textures/snow.png',
    snowSide:'textures/snow_side.png',
    jungleSide:'textures/jungle_tree_side.png',
    jungleTop:'textures/jungle_tree_top.png',
    jungleLeaves:'textures/jungle_leaves.png',
    cactusSide:'textures/cactus_side.png',
    cactusTop:'textures/cactus_top.png',
    ...PROCEDURAL_PAINTERS,
}

//! Texture atlas: every block texture in one image, so a chunk renders all its
//! solid blocks in a single draw call (each face instance picks its tile)

const TILE_SIZE = 16;
export const ATLAS_COLUMNS = 8;
const textureKeys = Object.keys(TEXTURE_SOURCES);
export const ATLAS_ROWS = Math.ceil(textureKeys.length / ATLAS_COLUMNS);
const tileOfKey = new Map(textureKeys.map((key, i) => [key, i]));

const atlasCanvas = isBrowser ? document.createElement('canvas') : null;
if (atlasCanvas) {
    atlasCanvas.width = ATLAS_COLUMNS * TILE_SIZE;
    atlasCanvas.height = ATLAS_ROWS * TILE_SIZE;
}
export const atlasTexture = atlasCanvas ? new THREE.CanvasTexture(atlasCanvas) : new THREE.Texture();
atlasTexture.colorSpace = THREE.SRGBColorSpace;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;

function drawTile(key, image) {
    if (!atlasCanvas) return;
    const tile = tileOfKey.get(key);
    const x = (tile % ATLAS_COLUMNS) * TILE_SIZE;
    const y = Math.floor(tile / ATLAS_COLUMNS) * TILE_SIZE;
    const ctx = atlasCanvas.getContext('2d');
    ctx.clearRect(x, y, TILE_SIZE, TILE_SIZE);
    if (image) ctx.drawImage(image, x, y, TILE_SIZE, TILE_SIZE);
    else paintMissing(ctx, x, y, TILE_SIZE);
    atlasTexture.needsUpdate = true;
}

function loadTexture(key, path){
    // Outside the browser (unit tests) there is nothing to load images with
    if (!isBrowser) return new THREE.Texture();

    // BASE_URL keeps paths working when the game is deployed under a sub-path
    const url = `${import.meta.env?.BASE_URL ?? '/'}${path}`;
    const texture=textureLoader.load(
        url,
        (loaded) => drawTile(key, loaded.image),
        undefined,
        () => {
            failedTextures.push(path);
            paintMissingTexture(texture);
            drawTile(key, null);
        }
    )
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.minFilter=THREE.NearestFilter;
    texture.magFilter=THREE.NearestFilter;
    return texture
}

const textures = {};
for (const [key, source] of Object.entries(TEXTURE_SOURCES)) {
    if (typeof source === 'string') {
        textures[key] = loadTexture(key, source);
    } else {
        const canvas = source();
        textures[key] = canvasTexture(canvas);
        if (canvas) drawTile(key, canvas);
    }
}
// Water scrolls its texture to look like it flows
textures.water.wrapS = textures.water.wrapT = THREE.RepeatWrapping;
export const waterTexture = textures.water;

// One material per texture (and transparency), shared by every block using it
const materialCache = new Map();
function materialFor(key, { alphaTest = 0, opacity = 1 } = {}) {
    const cacheKey = `${key}|${alphaTest}|${opacity}`;
    if (!materialCache.has(cacheKey)) {
        materialCache.set(cacheKey, new THREE.MeshLambertMaterial({
            map: textures[key],
            alphaTest,
            transparent: opacity < 1,
            opacity,
        }));
    }
    return materialCache.get(cacheKey);
}

/** Texture key of each face, in BoxGeometry order: +x, -x, +y, -y, +z, -z */
function faceKeys(textureSpec) {
    const { all, top = all, side = all } = textureSpec;
    // Logs and cacti only declare top and side: their bottom matches the top
    const bottom = textureSpec.bottom ?? all ?? top;
    return [side, side, top, bottom, side, side];
}

/**
 * Block registry. Ids are persisted in saved worlds, so never renumber them.
 *
 * Properties (all optional, defaults in brackets):
 * - label: display name
 * - textures: { all } or { top, bottom, side }: keys of TEXTURE_SOURCES
 * - transparent [false]: neighbours behind this block stay visible (not culled)
 * - solid [true]: false lets the player walk through it (collision)
 * - breakable [true]: false protects it from removal (destruction)
 * - placeable [true]: false hides it from the inventory (placement)
 * - replaceable [false]: placing a block into it replaces it (plants)
 * - shape ["cube"]: "cross" renders two crossed sprites (plants)
 * - sound: sound profile used when placing/breaking
 */
export const blocks = {
  empty: {
    id: 0
  },
  grass: {
    id: 1,
    name: 'grass',
    label: 'Grass',
    color: 0x559020,
    sound: 'grass',
    textures: { top: 'grass', bottom: 'dirt', side: 'grass_side' },
  },
  dirt: {
    id: 2,
    name: 'dirt',
    label: 'Dirt',
    color: 0x807020,
    sound: 'grass',
    textures: { all: 'dirt' },
  },
  stone:{
    id:3,
    name:'stone',
    label:'Stone',
    color:0x808080,
    sound:'stone',
    textures: { all: 'stone' },
    scale:{x:30,y:30,z:30},
    scarcity:0.5
  },
  ironOre:{
    id:4,
    name:'ironore',
    label:'Iron Ore',
    color:0x806060,
    sound:'stone',
    textures: { all: 'ironOre' },
    scale:{x:20,y:20,z:20},
    scarcity:0.9
  }
  ,
  coalOre:{
     id:5,
    name:'coalOre',
    label:'Coal Ore',
    color:0x202020,
    sound:'stone',
    textures: { all: 'coalOre' },
    scale:{x:60,y:60,z:60},
    scarcity:0.8
  },
  wood:{ id:6, name:'wood', label:'Oak Log', color:0x6b5130, sound:'wood', textures:{ top:'treeTop', side:'treeSide' } },
  oakPlanks:{ id:7, name:'oakPlanks', label:'Oak Planks', color:0xb8945f, sound:'wood', textures:{ all:'planks' } },
  brick:{ id:8, name:'brick', label:'Bricks', color:0x964634, sound:'stone', textures:{ all:'brick' } },
  sand:{ id:9, name:'sand', label:'Sand', color:0xdbcf8e, sound:'sand', textures:{ all:'sand' } },
  glass:{ id:10, name:'glass', label:'Glass', color:0xcde8f0, sound:'glass', transparent:true, alphaTest:0.5, textures:{ all:'glass' } },
  leaves:{ id:11, name:'leaves', label:'Oak Leaves', color:0x3f8f2a, sound:'grass', transparent:true, alphaTest:0.5, textures:{ all:'leaves' } },
  water:{ id:12, name:'water', label:'Water', color:0x3060d0, sound:'water', transparent:true, solid:false, replaceable:true, opacity:0.7, textures:{ all:'water' } },
  cobblestone:{ id:13, name:'cobblestone', label:'Cobblestone', color:0x7a7a7a, sound:'stone', textures:{ all:'cobblestone' } },
  snowyGrass:{ id:14, name:'snowyGrass', label:'Snowy Grass', color:0xf0f4f8, sound:'sand', textures:{ top:'snow', bottom:'dirt', side:'snowSide' } },
  snow:{ id:15, name:'snow', label:'Snow', color:0xf4f8fc, sound:'sand', textures:{ all:'snow' } },
  birchLog:{ id:16, name:'birchLog', label:'Birch Log', color:0xdedcd0, sound:'wood', textures:{ top:'birchTop', side:'birchSide' } },
  birchLeaves:{ id:17, name:'birchLeaves', label:'Birch Leaves', color:0x80a850, sound:'grass', transparent:true, alphaTest:0.5, textures:{ all:'birchLeaves' } },
  cherryLog:{ id:18, name:'cherryLog', label:'Cherry Log', color:0x542e32, sound:'wood', textures:{ top:'cherryTop', side:'cherrySide' } },
  cherryLeaves:{ id:19, name:'cherryLeaves', label:'Cherry Blossom', color:0xf0a0c8, sound:'grass', transparent:true, alphaTest:0.5, textures:{ all:'cherryLeaves' } },
  pineLog:{ id:20, name:'pineLog', label:'Pine Log', color:0x4a3422, sound:'wood', textures:{ top:'pineTop', side:'pineSide' } },
  pineLeaves:{ id:21, name:'pineLeaves', label:'Pine Needles', color:0x2c5238, sound:'grass', transparent:true, alphaTest:0.5, textures:{ all:'pineLeaves' } },
  jungleLog:{ id:22, name:'jungleLog', label:'Jungle Log', color:0x5a4524, sound:'wood', textures:{ top:'jungleTop', side:'jungleSide' } },
  jungleLeaves:{ id:23, name:'jungleLeaves', label:'Jungle Leaves', color:0x2f8a1e, sound:'grass', transparent:true, alphaTest:0.5, textures:{ all:'jungleLeaves' } },
  cactus:{ id:24, name:'cactus', label:'Cactus', color:0x3f7a2a, sound:'grass', transparent:true, alphaTest:0.5, textures:{ top:'cactusTop', side:'cactusSide' } },
  gravel:{ id:25, name:'gravel', label:'Gravel', color:0x7a726c, sound:'sand', textures:{ all:'gravel' } },
  tallGrass:{ id:26, name:'tallGrass', label:'Tall Grass', color:0x5c963a, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'tallGrass' } },
  fern:{ id:27, name:'fern', label:'Fern', color:0x3e7832, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'fern' } },
  poppy:{ id:28, name:'poppy', label:'Poppy', color:0xd22824, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'poppy' } },
  dandelion:{ id:29, name:'dandelion', label:'Dandelion', color:0xf6d628, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'dandelion' } },
  cornflower:{ id:30, name:'cornflower', label:'Cornflower', color:0x506ee6, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'cornflower' } },
  pinkTulip:{ id:31, name:'pinkTulip', label:'Pink Tulip', color:0xf496c4, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'pinkTulip' } },
  redMushroom:{ id:32, name:'redMushroom', label:'Red Mushroom', color:0xc8241e, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'redMushroom' } },
  brownMushroom:{ id:33, name:'brownMushroom', label:'Brown Mushroom', color:0x966c4c, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'brownMushroom' } },
  deadBush:{ id:34, name:'deadBush', label:'Dead Bush', color:0x7e582e, sound:'grass', shape:'cross', transparent:true, solid:false, replaceable:true, textures:{ all:'deadBush' } },
  mossyCobblestone:{ id:35, name:'mossyCobblestone', label:'Mossy Cobblestone', color:0x6e7a5e, sound:'stone', textures:{ all:'mossyCobblestone' } },
};

// Registry materials (icons, placement preview); chunks render through the atlas instead
for (const block of Object.values(blocks)) {
    if (!block.textures) continue;
    const options = { alphaTest: block.alphaTest ?? (block.shape === 'cross' ? 0.5 : 0), opacity: block.opacity ?? 1 };
    const keys = faceKeys(block.textures);
    const materials = keys.map((key) => materialFor(key, options));
    block.material = new Set(materials).size === 1 ? materials[0] : materials;
}

export const resources=[
    blocks.stone,
    blocks.coalOre,
    blocks.ironOre
]

//! Fast lookup tables by block id (used in hot loops: meshing, physics, raycasts)

export const MAX_BLOCK_ID = 255;
const blocksById = [];
Object.values(blocks).forEach((block) => (blocksById[block.id] = block));

/** Render layer per block id: 0 nothing, 1 solid atlas faces, 2 water, 3 crossed plant sprites */
export const LAYER = { none: 0, opaque: 1, water: 2, plant: 3 };
export const BLOCK_LAYER = new Uint8Array(MAX_BLOCK_ID + 1);
export const SEE_THROUGH = new Uint8Array(MAX_BLOCK_ID + 1).fill(1);
export const SOLID = new Uint8Array(MAX_BLOCK_ID + 1);
/** Atlas tile of each face: FACE_TILES[id * 6 + face] */
export const FACE_TILES = new Int16Array((MAX_BLOCK_ID + 1) * 6);

for (const block of Object.values(blocks)) {
    if (block.id === blocks.empty.id) continue;
    BLOCK_LAYER[block.id] = block.shape === 'cross' ? LAYER.plant : block.id === blocks.water.id ? LAYER.water : LAYER.opaque;
    SEE_THROUGH[block.id] = block.transparent === true ? 1 : 0;
    SOLID[block.id] = block.solid === false ? 0 : 1;
    faceKeys(block.textures).forEach((key, face) => (FACE_TILES[block.id * 6 + face] = tileOfKey.get(key)));
}

export function getBlockType(id) {
    return blocksById[id];
}

export function isValidBlockId(id) {
    return Number.isInteger(id) && blocksById[id] !== undefined;
}

// Lets light/vision through: empty space and transparent blocks
export function isSeeThrough(id) {
    return SEE_THROUGH[id] === 1;
}

export function isSolid(id) {
    return SOLID[id] === 1;
}

export function isBreakable(id) {
    return id !== blocks.empty.id && blocksById[id]?.breakable !== false;
}

export function isReplaceable(id) {
    return id === blocks.empty.id || blocksById[id]?.replaceable === true;
}

/**
 * One shared, frozen { id } object per block type: chunks store plain ids,
 * and getBlock() hands these out without allocating.
 */
export const BLOCK_REFS = blocksById.map((block) => block && Object.freeze({ id: block.id }));

// Everything the player can pick from the inventory
export const placeableBlocks = Object.values(blocks).filter(
    (block) => block.id !== blocks.empty.id && block.placeable !== false
);

export function isPlaceable(id) {
    return placeableBlocks.includes(blocksById[id]);
}

// Initial contents of the 9 hotbar slots
export const defaultHotbar = [
    blocks.grass.id,
    blocks.dirt.id,
    blocks.stone.id,
    blocks.cobblestone.id,
    blocks.wood.id,
    blocks.oakPlanks.id,
    blocks.brick.id,
    blocks.glass.id,
    blocks.sand.id,
];
