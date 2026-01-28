import * as THREE from "three";
import WorldChunk from "./worldChunk";

export class World extends THREE.Group {
  params = {
    seed: 0,
    terrain: {
      scale: 30,
      magnitude: 0.5,
      offset: 0.2,
    },
  };
  chunkSize = { width: 64, height: 32 };
  chunk;
  drawDistance = 1;
  constructor(seed = 0) {
    super();
    this.seed = seed;
  }

  generate() {
    this.disposeChunk();
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        const chunk = new WorldChunk(this.chunkSize, this.params);
        chunk.position.set(
          x * this.chunkSize.width,
          0,
          z * this.chunkSize.width
        );
        chunk.userData = { x, z };
        chunk.generate();
        this.add(chunk);
      }
    }
  }

  getBlock(x, y, z) {
    let coords= this.worldToChunkCoords(x, y, z);
    const chunk= this.getChunk(coords.chunk.x, coords.chunk.z);
    if(chunk){
      return chunk.getBlock(coords.block.x, coords.block.y, coords.block.z);
    }
    else{
      return null;
    }
  }

  update(player){
    const visibleChunks=this.getVisibleChunks(player);
    console.log(visibleChunks);
    

  }

  getVisibleChunks(player){
    const visibleChunks=[]

    let coords=this.worldToChunkCoords(player,this.position.x,player.position.y,this.position.z);

    const chunkX=coords.chunk.x
    const chunkZ=coords.chunk.z

    for (let x = chunkX - this.drawDistance; x <= chunkX + this.drawDistance; x++) {
      for (let z = chunkZ - this.drawDistance; z <= chunkZ + this.drawDistance; z++) {
        const chunk = this.getChunk(x, z);
          visibleChunks.push(chunk);
      }
    }
    return visibleChunks
  }

  getChunkstoAdd(visibleChunks){
    
  }
 
  getChunk(chunkX, chunkZ) {
    for (let i = 0; i < this.children.length; i++) {
      const chunk = this.children[i];
      if (chunk.userData.x === chunkX && chunk.userData.z === chunkZ) {
        return chunk;
      }
    }
  }

  worldToChunkCoords(x, y, z) {
    const chunkCoords = {
      x: Math.floor(x / this.chunkSize.width),
      z: Math.floor(z / this.chunkSize.width),
    };
    const blockCoords = {
      x: x - chunkCoords.x * this.chunkSize.width,
      y,
      z: z - chunkCoords.z * this.chunkSize.width,
    };
    return { chunk: chunkCoords, block: blockCoords };
  }

  disposeChunk() {
    this.traverse((chunk) => {
      if (chunk.disposeInstances) {
        chunk.disposeInstances();
      }
    });
    this.clear();
  }
}
