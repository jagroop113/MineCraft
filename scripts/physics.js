import * as THREE from "three";

import { blocks } from "./blocks";
import { Player } from "./player";

const collisionMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.2,
});

const contactMaterial = new THREE.MeshBasicMaterial({
  wireframe: true,
  color: 0x00ff00,
});
const contactGeometry = new THREE.SphereGeometry(0.05, 6, 6);

const collisiGeometry = new THREE.BoxGeometry(1.001, 1.001, 1.001);

export class Physics {
  // Acceleration due to gravityMore actions
  gravity = 32;

  // Physic simulation rate
  simulationRate = 250;
  stepSize = 1 / this.simulationRate;
  // Accumulator to keep track of leftover dt
  accumulator = 0;
  constructor(scene) {
    this.helpers = new THREE.Group();
    scene.add(this.helpers);
  }

  broadPhase(player, world) {
    this.helpers.clear();
    const candidates = [];

    const extents = {
      x: {
        min: Math.floor(player.position.x - player.radius),
        max: Math.ceil(player.position.x + player.radius),
      },
      y: {
        min: Math.floor(player.position.y - player.height),
        max: Math.ceil(player.position.y),
      },
      z: {
        min: Math.floor(player.position.z - player.radius),
        max: Math.ceil(player.position.z + player.radius),
      },
    };
    for (let x = extents.x.min; x <= extents.x.max; x++) {
      for (let y = extents.y.min; y <= extents.y.max; y++) {
        for (let z = extents.z.min; z <= extents.z.max; z++) {
          const block = world.getBlock(x, y, z);
          if (block && block.id !== blocks.empty.id) {
            const blockPos = { x, y, z };
            candidates.push(blockPos);
            this.addCollisionHelper(blockPos);
          }
        }
      }
    }

    // console.log(`Candidates :${candidates.length}`);

    return candidates;
  }

  narrowPhase(candidates, player) {
    const collisions = [];
    for (const block of candidates) {
      const p = player.position;
      //Closet Point on block with respect to the player
      const closestPoint = {
        x: Math.max(block.x - 0.5, Math.min(p.x, block.x + 0.5)),
        y: Math.max(
          block.y - 0.5,
          Math.min(p.y - player.height / 2, block.y + 0.5)
        ),
        z: Math.max(block.z - 0.5, Math.min(p.z, block.z + 0.5)),
      };

      //Determine if block is touch by player

      const dx = closestPoint.x - player.position.x;
      const dy = closestPoint.y - (player.position.y - player.height / 2);
      const dz = closestPoint.z - player.position.z;

      if (this.pointInPlayerBoundingCylinder(closestPoint, player)) {
        const overlapY = player.height / 2 - Math.abs(dy);
        const overlapXZ = player.radius - Math.sqrt(dx * dx + dz * dz);

        let normal, overlap;
        if (overlapY < overlapXZ) {
          normal = new THREE.Vector3(0, -Math.sign(dy), 0);
          overlap = overlapY;
          player.onGround = true;
        } else {
          normal = new THREE.Vector3(-dx, 0, -dz).normalize();
          overlap = overlapXZ;
        }

        collisions.push({
          block,
          contactPoint: closestPoint,
          normal,
          overlap,
        });
        this.addContactPointerHelper(closestPoint);
      }
    }

    return collisions;
  }
  resolveCollisions(collisions, player) {
    collisions.sort((a, b) => a.overlap < b.overlap);

    for (const collision of collisions) {
      if(!this.pointInPlayerBoundingCylinder(collision.contactPoint,player))
        continue;

      let deltaPosition = collision.normal.clone();
      deltaPosition.multiplyScalar(collision.overlap);
      player.position.add(deltaPosition);

      // Fix: Place this here inside the loop
      let magnitude = player.worldVelocity.dot(collision.normal);
      let velocityAdjustment = collision.normal
        .clone()
        .multiplyScalar(magnitude);
      player.applyWorldDeltaVelocity(velocityAdjustment.negate());
    }
  }

  detectCollisions(player, world) {
    player.onGround = false;
    const candidates = this.broadPhase(player, world);
    const collisions = this.narrowPhase(candidates, player);

    if (collisions.length > 0) {
      this.resolveCollisions(collisions, player);
    }
  }

  update(dt, player, world) {
    this.accumulator += dt;
    while (this.accumulator >= this.stepSize) {
      player.velocity.y -= this.gravity * this.stepSize;
      player.applyInput(this.stepSize);
      this.detectCollisions(player, world);
      this.accumulator -= this.stepSize;
    }
  }

  addCollisionHelper(block) {
    const blockMesh = new THREE.Mesh(collisiGeometry, collisionMaterial);
    blockMesh.position.copy(block);
    this.helpers.add(blockMesh);
  }
  addContactPointerHelper(p) {
    const contactMesh = new THREE.Mesh(contactGeometry, contactMaterial);
    contactMesh.position.copy(p);
    this.helpers.add(contactMesh);
  }

  pointInPlayerBoundingCylinder(p, player) {
    const dx = p.x - player.position.x;
    const dy = p.y - (player.position.y - player.height / 2);
    const dz = p.z - player.position.z;

    const r_sq = dx * dx + dz * dz;

    return (
      Math.abs(dy) < player.height / 2 && r_sq < player.radius * player.radius
    );
  }
}
