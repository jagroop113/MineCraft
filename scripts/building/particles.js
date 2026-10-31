import * as THREE from "three";
import { isSolid } from "../blocks";

const MAX_PARTICLES = 512;
const GRAVITY = 20;

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshLambertMaterial();
const matrix = new THREE.Matrix4();
const scale = new THREE.Vector3();
const rotation = new THREE.Quaternion();

/**
 * Small cubes that burst out of a broken block. All particles share one
 * InstancedMesh, so a burst costs no new geometry, material or draw call.
 */
export class BlockParticles {
  #particles = [];

  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
  }

  burst(position, color, amount = 24) {
    const baseColor = new THREE.Color(color);
    for (let i = 0; i < amount && this.#particles.length < MAX_PARTICLES; i++) {
      const life = 0.5 + Math.random() * 0.4;
      this.#particles.push({
        position: new THREE.Vector3(
          position.x + Math.random() - 0.5,
          position.y + Math.random() - 0.5,
          position.z + Math.random() - 0.5
        ),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          Math.random() * 4 + 1,
          (Math.random() - 0.5) * 4
        ),
        size: 0.08 + Math.random() * 0.1,
        color: baseColor.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
        life,
        maxLife: life,
      });
    }
  }

  update(dt) {
    const particles = this.#particles;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }

      p.velocity.y -= GRAVITY * dt;
      p.position.addScaledVector(p.velocity, dt);

      // Land on top of solid blocks instead of falling through them
      const block = this.world.getBlock(
        Math.round(p.position.x),
        Math.round(p.position.y),
        Math.round(p.position.z)
      );
      if (block && isSolid(block.id) && p.velocity.y < 0) {
        p.position.y = Math.round(p.position.y) + 0.5 + p.size / 2;
        p.velocity.set(p.velocity.x * 0.5, 0, p.velocity.z * 0.5);
      }
    }

    particles.forEach((p, i) => {
      scale.setScalar(p.size * Math.sqrt(p.life / p.maxLife));
      matrix.compose(p.position, rotation, scale);
      this.mesh.setMatrixAt(i, matrix);
      this.mesh.setColorAt(i, p.color);
    });
    // Nothing to upload while no particles are alive
    if (this.mesh.count === 0 && particles.length === 0) return;
    this.mesh.count = particles.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.#particles.length = 0;
    this.scene.remove(this.mesh);
    this.mesh.dispose();
  }
}
