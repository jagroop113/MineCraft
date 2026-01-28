import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import { blocks, resources } from "./blocks";

export function createUI(world, player) {
  const gui = new GUI();

  let playerFolder = gui.addFolder("Player");

  playerFolder.add(player, "maxSpeed", 1, 20, 1).name("Player Speed");
  playerFolder.add(player.cameraHelper, "visible").name("Show Player");

  //terrain

  const terrainFolder = gui.addFolder("Terrain");
  terrainFolder.add(world.chunkSize, "width", 8, 128, 1).name("Width");
  terrainFolder.add(world.chunkSize, "height", 0, 64, 1).name("Height");
  terrainFolder.add(world.params.terrain, "scale", 10, 100, 1).name("Scale");
  terrainFolder.add(world.params.terrain, "offset", 0, 1).name("OffSet");
  terrainFolder.add(world.params.terrain, "magnitude", 0, 1).name("magnitude");
  terrainFolder.add(world.params, "seed", 0, 1000).name("Map");

  const ResourceFolder = gui.addFolder("Resources");
  resources.forEach((resource) => {
    const resourcef = ResourceFolder.addFolder(resource.name);
    resourcef.add(resource, "scarcity", 0, 1).name("ScarCity");

    const scalefolder = resourcef.addFolder("Scales");
    scalefolder.add(resource.scale, "x", 10, 100).name("X Scale");
    scalefolder.add(resource.scale, "y", 10, 100).name("Y Scale");
    scalefolder.add(resource.scale, "z", 10, 100).name("Z Scale");
  });

  ResourceFolder.close();

  terrainFolder.close();
  gui.close();

  gui.onChange(() => {
    world.generate();
  });
}
