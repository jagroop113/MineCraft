import * as THREE from "three";
import { blocks } from "../blocks.js";


export class NPC {
  radius = 0.4;
  height = 1.7;
  speed = 2.2;
  wanderRadius = 8; // how far from spawn point it will roam

  state = "idle"; // "idle" | "walk"
  stateTimer = 0;
  target = new THREE.Vector3();

  constructor(scene, world, spawnX, spawnZ) {
    this.scene = scene;
    this.world = world;

    this.mesh = new THREE.Group();

    const bodyGeo = new THREE.CapsuleGeometry(this.radius, this.height - 2 * this.radius, 4, 8);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xdd6622 });
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.castShadow = true;
    this.body.position.y = this.height / 2;
    this.mesh.add(this.body);

    // Small cone so we can see which way it's facing
    const noseGeo = new THREE.ConeGeometry(0.12, 0.4, 6);
    const noseMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    this.nose = new THREE.Mesh(noseGeo, noseMat);
    this.nose.rotation.x = Math.PI / 2;
    this.nose.position.set(0, this.height - this.radius, this.radius + 0.2);
    this.mesh.add(this.nose);

    this.spawnPoint = new THREE.Vector3(spawnX, 0, spawnZ);
    this.spawn(spawnX, spawnZ);

    scene.add(this.mesh);
  }

  get position() {
    return this.mesh.position;
  }

  /** Places the NPC on top of the highest solid block at (x, z). */
  spawn(x, z) {
    const groundY = this.findGroundHeight(x, z);
    this.mesh.position.set(x, groundY, z);
    this.spawnPoint.set(x, groundY, z);
  }

  findGroundHeight(x, z) {
    const maxHeight = this.world.chunkSize?.height ?? 32;
    for (let y = maxHeight - 1; y >= 0; y--) {
      const block = this.world.getBlock(Math.floor(x), y, Math.floor(z));
      if (block && block.id !== blocks.empty.id) {
        return y + 1;
      }
    }
    return 0;
  }

  pickNewTarget() {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * this.wanderRadius;
    const x = this.spawnPoint.x + Math.cos(angle) * dist;
    const z = this.spawnPoint.z + Math.sin(angle) * dist;
    const y = this.findGroundHeight(x, z);
    this.target.set(x, y, z);
  }

  update(dt, world) {
    this.stateTimer -= dt;

    if (this.state === "idle") {
      if (this.stateTimer <= 0) {
        this.pickNewTarget();
        this.state = "walk";
      }
    } else if (this.state === "walk") {
      const toTarget = new THREE.Vector3(
        this.target.x - this.mesh.position.x,
        0,
        this.target.z - this.mesh.position.z
      );
      const dist = toTarget.length();

      if (dist < 0.2) {
        this.state = "idle";
        this.stateTimer = 1 + Math.random() * 2; // pause 1-3s before next wander
      } else {
        toTarget.normalize();
        this.mesh.position.x += toTarget.x * this.speed * dt;
        this.mesh.position.z += toTarget.z * this.speed * dt;

        // Snap to terrain height under current position
        this.mesh.position.y = this.findGroundHeight(
          this.mesh.position.x,
          this.mesh.position.z
        );

        // Face movement direction
        const targetAngle = Math.atan2(toTarget.x, toTarget.z);
        this.mesh.rotation.y = targetAngle;
      }
    }
  }
}