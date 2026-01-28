import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import { World } from "./world";
import Stats from 'stats.js';
import { createUI } from "./ui";
import { Player } from "./player";
import { Physics } from "./physics";

console.log("Start");

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


//!Orbit control

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(16, 0, 16)
controls.update()

//!scene
const scene = new THREE.Scene();

//!World 
const world = new World()
world.generate()
scene.add(world)


//!Physics

const physics = new Physics(scene)


//!Player
const player = new Player(scene)

//!FPS
const stats = new Stats()
document.body.append(stats.dom)

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
}
// !--- MULTIPLAYER  ---
// const socket = new WebSocket("http://157.119.42.36:3001/");
const socket = new WebSocket("https://mine.v2stech.in/");

let myId = null;
const otherPlayers = {};

socket.onmessage = (e) => {
  const data = JSON.parse(e.data);

  if (data.type === "id") {
    myId = data.id;
    console.log(data.id);
    
  }

  if (data.type === "players") {
    syncPlayers(data.players);
  }
};

function syncPlayers(players) {
  for (const id in players) {
    if (id === myId) continue;

    if (!otherPlayers[id]) {
      const geo = new THREE.BoxGeometry(1, 2, 1);
      const mat = new THREE.MeshStandardMaterial({ color: 'red'});
      const mesh = new THREE.Mesh(geo, mat);
      
      scene.add(mesh);
      otherPlayers[id] = mesh;
    }

    const p = players[id];
    otherPlayers[id].position.set(p.x, p.y, p.z);
  }
}
setInterval(() => {
  if (!myId) return;

  socket.send(JSON.stringify({
    type: "move",
    pos: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z
    }
  }));
}, 100); // 10 times/sec


//Loop
let prevoiusTime = performance.now()
function animate() {
  let currentTime = performance.now();
  let dt = (currentTime - prevoiusTime) / 1000;
  requestAnimationFrame(animate);


  physics.update(dt, player, world)
  //! Update the Fps Stats 
  stats.update()
  player.updateBoundHelper()
  renderer.render(scene, player.controls.isLocked ? player.camera : camera);
  world.update(player)
  prevoiusTime = currentTime;
}


//! Resize

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  player.camera.aspect = window.innerWidth / window.innerHeight;
  player.camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);


  renderer.render(scene, camera);

  stats.update()
});


setUpLights();
createUI(world, player)
animate();
