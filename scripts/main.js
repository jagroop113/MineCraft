import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { World } from "./world";
import { Player } from "./player";
import { Physics } from "./physics";
import { NPC } from "./Npc/npc";
import { BuildingGame } from "./building/game";
import { connectMultiplayer } from "./multiplayer";

// ?debug in the URL enables the developer tools (terrain GUI, stats, helpers, free camera)
const debug = new URLSearchParams(window.location.search).has("debug");

// Large frame gaps (e.g. returning to a background tab) are clamped so physics can't jump
const MAX_FRAME_SECONDS = 0.1;

//!Render Setup

const renderer = new THREE.WebGLRenderer();
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x80a0e0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement);

//!camera

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight
);
camera.position.set(-32, 16, -32);


//!Orbit control (debug free camera)

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(16, 0, 16)
controls.update()

//!scene (sky colour, fog and lighting come from the environment's day/night cycle)
const scene = new THREE.Scene();

//!World (endless: chunks stream in around the player once a save is loaded)
const world = new World()
scene.add(world)


//!Physics

const physics = new Physics(scene)
physics.showHelpers = debug


//!Player
const player = new Player(scene)
player.cameraHelper.visible = debug
player.boundHelper.visible = debug


//! NPC
//* created next to the player once the world has loaded (see game.start below)
let npcs = [];


//!Lights

function setUpLights() {
  const sun = new THREE.DirectionalLight();
  sun.position.set(50, 50, 50);
  sun.castShadow = true
  sun.shadow.camera.left = -50
  sun.shadow.camera.right = 50
  sun.shadow.camera.top = 50
  sun.shadow.camera.bottom = -50
  sun.shadow.camera.near = 0.1
  sun.shadow.camera.far = 100
  sun.shadow.bias = -0.0005;


  const ambient = new THREE.AmbientLight();
  ambient.intensity = 0.1;

  scene.add(sun, ambient);
  return { sun, ambient };
}
const { sun, ambient } = setUpLights();

//! Game (building, inventory, menus, saving, environment, wildlife, mobile controls)
const game = new BuildingGame({ scene, world, player, renderer, sun, ambient, debug })

// !--- MULTIPLAYER  ---
// Set VITE_MULTIPLAYER_URL (see .env.example) to connect; without it the game is single-player
const multiplayerUrl = import.meta.env.VITE_MULTIPLAYER_URL;
if (multiplayerUrl) connectMultiplayer({ url: multiplayerUrl, scene, player });

//!Debug tools (loaded on demand so they stay out of the normal bundle)
let stats = null;
if (debug) {
  // Console / automated-test access to the running game
  window.__game = game;
  window.__physics = physics;
  window.__player = player;
  Promise.all([import("stats.js"), import("./ui")]).then(([{ default: Stats }, { createUI }]) => {
    stats = new Stats()
    document.body.append(stats.dom)
    const gui = createUI(world, player)
    // Terrain edits in the GUI regenerate the world, so they need saving too
    gui.onFinishChange(() => game.worldManager?.markDirty())
  });
}


//Loop
let prevoiusTime = performance.now()
function animate() {
  let currentTime = performance.now();
  let dt = Math.min((currentTime - prevoiusTime) / 1000, MAX_FRAME_SECONDS);
  requestAnimationFrame(animate);


  // Gravity only runs while playing, and only once the ground under the player has loaded
  if (!game.paused && world.isLoadedAt(player.position.x, player.position.z)) physics.update(dt, player, world)
  game.update(dt)
  //! Update the Fps Stats
  stats?.update()
  player.updateBoundHelper()
  player.updatePositionDisplay()
  controls.enabled = !game.usesPlayerCamera
  renderer.render(scene, game.usesPlayerCamera ? player.camera : camera);
  world.update(player)
  for (const npc of npcs) npc.update(dt, world)
  prevoiusTime = currentTime;
}


//! Resize

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  player.camera.aspect = window.innerWidth / window.innerHeight;
  player.camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);


  renderer.render(scene, game.usesPlayerCamera ? player.camera : camera);
});


animate();
game.start().then(() => {
  const { x, z } = player.position;
  npcs = [new NPC(scene, world, x - 4, z - 4), new NPC(scene, world, x + 4, z - 3), new NPC(scene, world, x - 3, z + 4)];
});
