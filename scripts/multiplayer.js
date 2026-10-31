import * as THREE from "three";

const SEND_INTERVAL_MS = 100; // 10 times/sec
const RECONNECT_DELAY_MS = 5000;

const playerGeometry = new THREE.BoxGeometry(1, 2, 1);

/**
 * Shows other players as boxes and sends our position to the server.
 * Protocol (server/server.js):
 *   server → { type: "id", id } once, then { type: "players", players: { [id]: {x, y, z} } }
 *   client → { type: "move", pos: {x, y, z} }
 *
 * @param {{ url: string, scene: THREE.Scene, player: import("./player").Player }} options
 * @returns {() => void} disconnect
 */
export function connectMultiplayer({ url, scene, player }) {
  let socket = null;
  let myId = null;
  let closed = false;
  let reconnectTimer = null;
  const otherPlayers = new Map();

  function removePlayer(id) {
    const mesh = otherPlayers.get(id);
    scene.remove(mesh);
    mesh.material.dispose();
    otherPlayers.delete(id);
  }

  function syncPlayers(players) {
    for (const id in players) {
      if (id === myId) continue;

      if (!otherPlayers.has(id)) {
        const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.55);
        const mesh = new THREE.Mesh(playerGeometry, new THREE.MeshStandardMaterial({ color }));
        scene.add(mesh);
        otherPlayers.set(id, mesh);
      }

      const p = players[id];
      if ([p?.x, p?.y, p?.z].every(Number.isFinite)) otherPlayers.get(id).position.set(p.x, p.y, p.z);
    }
    // Players who left are no longer in the list
    for (const id of otherPlayers.keys()) {
      if (!(id in players)) removePlayer(id);
    }
  }

  function connect() {
    try {
      socket = new WebSocket(url);
    } catch (error) {
      console.warn("Multiplayer disabled, invalid server URL:", error.message);
      return;
    }
    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "id") myId = data.id;
      if (data.type === "players" && data.players && typeof data.players === "object") syncPlayers(data.players);
    };
    socket.onclose = () => {
      myId = null;
      for (const id of [...otherPlayers.keys()]) removePlayer(id);
      if (!closed) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    };
  }

  const sendTimer = setInterval(() => {
    if (!myId || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "move",
        pos: { x: player.position.x, y: player.position.y, z: player.position.z },
      })
    );
  }, SEND_INTERVAL_MS);

  connect();

  return () => {
    closed = true;
    clearInterval(sendTimer);
    clearTimeout(reconnectTimer);
    socket?.close();
  };
}
