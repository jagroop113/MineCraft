import { texturesLoaded } from "../blocks";
import { Environment } from "../environment/environment";
import { TouchControls } from "../mobile/touchControls";
import { Wildlife } from "../wildlife/wildlife";
import { BuildingSystem } from "./buildingSystem";
import { GraphicsController, isTouchDevice } from "./graphics";
import { InputController } from "./inputController";
import { Inventory } from "./inventory";
import { BlockParticles } from "./particles";
import { PerformanceMonitor } from "./performanceMonitor";
import { Settings } from "./settings";
import { BlockSounds } from "./sounds";
import { WorldManager } from "./worldManager";
import { WorldPersistence } from "./worldPersistence";
import { element } from "./ui/dom";
import { BuildHUD } from "./ui/hud";
import { GameMenus } from "./ui/menus";

const TEXTURE_TIMEOUT_MS = 15000;
// Falling below this height respawns the player
const VOID_HEIGHT = -20;

// Seconds between world-info refreshes (biome, time, weather, coordinates)
const INFO_INTERVAL = 0.5;

/**
 * Creative building game on top of the existing World / Player / Physics:
 * wires game logic, input, environment, wildlife, UI and persistence
 * together and owns the game state.
 *
 * States: "loading" → "menu" (pause / title) ⇄ "playing" ⇄ "inventory",
 * plus "freecam" (debug orbit camera). On touch devices "playing" needs no
 * pointer lock: the on-screen controls drive the player instead.
 */
export class BuildingGame {
  state = "loading";
  /** Touch controls active (phones / tablets, or after the first touch) */
  touchMode = false;
  #firstStart = true;
  #abort = new AbortController();
  #infoTimer = 0;
  #lastTouch = 0;

  /**
   * @param {{
   *   scene: THREE.Scene, world: import("../world").World, player: import("../player").Player,
   *   renderer: THREE.WebGLRenderer, sun: THREE.DirectionalLight, ambient: THREE.AmbientLight, debug?: boolean,
   * }} options
   */
  constructor({ scene, world, player, renderer, sun, ambient, debug = false }) {
    this.world = world;
    this.player = player;
    this.renderer = renderer;
    this.sun = sun;
    this.debug = debug;

    this.settings = new Settings();
    this.inventory = new Inventory(this.settings.hotbar ?? undefined);
    this.sounds = new BlockSounds();
    this.particles = new BlockParticles(scene, world);
    this.building = new BuildingSystem({
      scene,
      world,
      player,
      inventory: this.inventory,
      effects: {
        onPlace: (position, blockType) => this.sounds.play("place", blockType),
        onBreak: (position, blockType) => {
          this.sounds.play("break", blockType);
          this.particles.burst(position, blockType.color);
        },
      },
    });
    this.building.onChange(() => {
      this.worldManager?.markDirty();
      this.graphics?.requestShadowUpdate();
    });

    this.environment = new Environment({ scene, sun, ambient, world, player });
    this.wildlife = new Wildlife({ scene, world });
    this.graphics = new GraphicsController({
      renderer,
      world,
      sun,
      camera: player.camera,
      environment: this.environment,
      wildlife: this.wildlife,
    });

    this.uiRoot = element("div", "game-ui", document.body);
    this.hud = new BuildHUD(this.uiRoot, { onSelectSlot: (slot) => this.inventory.select(slot) });
    this.menus = new GameMenus(this.uiRoot, this.#menuCallbacks(debug), { settings: this.settings });
    this.performance = new PerformanceMonitor(renderer, world, this.hud.perf);
    this.performance.onSample = (stats) => this.graphics.sample(stats.fps);
    const inputActions = this.#inputActions();
    this.input = new InputController({
      player,
      canvas: renderer.domElement,
      getState: () => this.state,
      isTouchMode: () => this.touchMode,
      actions: inputActions,
    });
    this.touch = new TouchControls({
      root: this.uiRoot,
      player,
      world,
      isPlaying: () => this.state === "playing",
      actions: {
        place: inputActions.place,
        remove: inputActions.remove,
        pause: () => this.#pause(),
        settings: () => {
          this.#pause();
          this.menus.open("settings");
        },
        inventory: () => inputActions.toggleInventory(),
        toggleFullscreen: () => this.#toggleFullscreen(),
      },
    });
    this.#setTouchMode(isTouchDevice());

    this.inventory.onChange((inventory) => {
      this.hud.setHotbar(inventory.slots, inventory.selectedSlot);
      this.menus.setInventorySelection(inventory.selectedBlockId);
      this.settings.hotbar = [...inventory.slots];
      this.settings.save();
    });
    this.hud.setHotbar(this.inventory.slots, this.inventory.selectedSlot, { announce: false });
    this.menus.setInventorySelection(this.inventory.selectedBlockId);
    this.hud.setMode(this.building.mode);

    this.settings.onChange((key, value) => this.#applySetting(key, value));
    this.#listen();
  }

  /** Whether the first-person camera is rendered (false only for the debug free camera) */
  get usesPlayerCamera() {
    return this.state !== "freecam";
  }

  /** Physics and building only run while the player is in control */
  get paused() {
    return this.state !== "playing";
  }

  /** Loads textures and the last world, then shows the title menu */
  async start() {
    this.menus.showLoading("Loading textures…");
    const failed = await Promise.race([
      texturesLoaded,
      new Promise((resolve) => setTimeout(() => resolve(["(timed out)"]), TEXTURE_TIMEOUT_MS)),
    ]);
    if (failed.length > 0) {
      this.hud.toast(`Some textures couldn't be loaded (${failed.join(", ")}).`, "error");
    }

    this.menus.showLoading("Opening your world…");
    const persistence = await WorldPersistence.open();
    if (!persistence.persistent) {
      this.hud.toast("Saving isn't available in this browser; progress lasts until you close the tab.", "error");
    }
    this.worldManager = new WorldManager({
      world: this.world,
      player: this.player,
      persistence,
      settings: this.settings,
    });
    this.worldManager.environment = {
      save: () => this.environment.getState(),
      load: (state) => this.environment.setState(state ?? { time: 0.3, weather: "clear" }),
    };
    this.worldManager.onStatus((status) => {
      this.hud.setSaveStatus(status);
      if (status.state === "error") this.hud.toast(`Couldn't save: ${status.message}`, "error");
    });

    // Graphics first, so phones generate and render the first chunks at their own settings
    this.graphics.apply(this.settings.get("graphics"));
    try {
      const warnings = await this.worldManager.init();
      warnings.forEach((warning) => this.hud.toast(warning, "error"));
    } catch (error) {
      console.error(error);
      this.hud.toast(`Couldn't open a saved world: ${error.message}`, "error");
      this.worldManager.spawnPlayer();
    }

    for (const [key, value] of Object.entries(this.settings.values)) this.#applySetting(key, value);
    this.menus.hideLoading();
    this.#setState("menu");
  }

  update(dt) {
    const playing = this.state === "playing";
    this.input.update(dt);
    this.touch.update(dt);
    this.building.update(playing);
    this.particles.update(dt);
    this.performance.update(dt);
    this.graphics.update();
    if (this.state !== "loading" && this.worldManager?.current) {
      this.environment.update(dt);
      this.wildlife.update(dt, { player: this.player, night: 1 - this.environment.sun.daylight });
    }

    this.#infoTimer -= dt;
    if (this.#infoTimer <= 0) {
      this.#infoTimer = INFO_INTERVAL;
      this.#updateInfo();
    }

    if (playing && this.player.position.y < VOID_HEIGHT) {
      this.worldManager?.spawnPlayer();
      this.hud.toast("You fell out of the world, back to spawn.");
    }
  }

  dispose() {
    this.#abort.abort();
    this.input.dispose();
    this.building.dispose();
    this.particles.dispose();
    this.sounds.dispose();
    this.environment.dispose();
    this.wildlife.dispose();
    this.touch.dispose();
    this.worldManager?.dispose();
    this.uiRoot.remove();
  }

  //! State

  #setState(state) {
    this.state = state;
    this.hud.setPlaying(state === "playing");
    this.uiRoot.classList.toggle("playing", state === "playing");
    this.player.touchActive = this.touchMode && state === "playing";
    if (state !== "playing") {
      this.input.releaseButtons();
      this.touch.releaseAll();
      this.player.clearInput();
    }
    if (state === "menu") {
      this.menus.setPauseInfo({
        worldName: this.worldManager?.current?.name ?? "",
        firstStart: this.#firstStart,
      });
      if (this.menus.screen === null || this.menus.screen === "inventory") this.menus.open("pause");
    } else if (state === "inventory") {
      this.menus.open("inventory");
    } else {
      this.menus.close();
    }
  }

  #resume() {
    if (this.state === "loading") return;
    // Audio may only start after a user gesture like this one
    this.environment.ambience.start();
    if (this.touchMode) {
      // Touch play needs no pointer lock
      this.#firstStart = false;
      this.#setState("playing");
      return;
    }
    // A click / key press counts as the user gesture pointer lock requires
    this.player.controls.domElement.requestPointerLock()?.catch?.(() => {});
  }

  #pause() {
    if (this.state !== "playing" && this.state !== "inventory") return;
    if (this.player.controls.isLocked) this.player.controls.unlock();
    this.#setState("menu");
    this.worldManager?.saveIfNeeded().catch(() => {});
  }

  #setTouchMode(enabled) {
    if (this.touchMode === enabled) return;
    this.touchMode = enabled;
    this.touch.setEnabled(enabled);
    this.player.touchActive = enabled && this.state === "playing";
  }

  #updateInfo() {
    const name = this.worldManager?.current?.name;
    if (!name) return;
    const p = this.player.position;
    const text = `${name} · ${this.environment.describe()} · ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`;
    this.hud.setWorldInfo(text);
    this.touch.setInfo(`${this.environment.describe()} · ${Math.round(p.x)}, ${Math.round(p.z)}`);
  }

  #listen() {
    const signal = this.#abort.signal;
    const controls = this.player.controls;
    const onLock = () => {
      this.#firstStart = false;
      this.#setState("playing");
    };
    const onUnlock = () => {
      if (this.state !== "playing") return;
      this.#setState("menu");
      // Pausing is a natural checkpoint
      this.worldManager?.saveIfNeeded().catch(() => {});
    };
    controls.addEventListener("lock", onLock);
    controls.addEventListener("unlock", onUnlock);
    signal.addEventListener("abort", () => {
      controls.removeEventListener("lock", onLock);
      controls.removeEventListener("unlock", onUnlock);
    });

    // Switch between touch and mouse controls depending on what the player uses
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "touch") {
          this.#lastTouch = performance.now();
          this.#setTouchMode(true);
        }
      },
      { signal, capture: true }
    );
    window.addEventListener(
      "pointermove",
      (event) => {
        if (event.pointerType === "mouse" && this.touchMode && performance.now() - this.#lastTouch > 1500 && (event.movementX || event.movementY)) {
          this.#setTouchMode(false);
          if (this.state === "playing") this.#pause();
        }
      },
      { signal }
    );

    document.addEventListener(
      "pointerlockerror",
      () => {
        if (this.state === "inventory") this.#setState("menu");
        this.hud.toast("Click “Back to game” to continue.");
      },
      { signal }
    );

    // WebGLRenderer restores its resources itself; keep the player informed meanwhile
    const canvas = this.renderer.domElement;
    canvas.addEventListener(
      "webglcontextlost",
      () => {
        if (this.player.controls.isLocked) this.player.controls.unlock();
        this.menus.showLoading("Graphics were interrupted. Restoring…");
      },
      { signal }
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        this.menus.hideLoading();
        this.hud.toast("Graphics restored.");
      },
      { signal }
    );
  }

  /** Runs a world operation behind the loading screen and reports failures */
  async #withLoading(message, failureMessage, task) {
    const previous = this.state;
    const worldId = this.worldManager.current?.id;
    this.state = "loading";
    this.menus.showLoading(message);
    try {
      const warnings = await task();
      (warnings ?? []).forEach((warning) => this.hud.toast(warning, "error"));
      // Undo steps belong to the world they were made in
      if (this.worldManager.current?.id !== worldId) this.building.history.clear();
      return true;
    } catch (error) {
      console.error(error);
      this.hud.toast(`${failureMessage}: ${error.message}`, "error");
      return false;
    } finally {
      this.graphics.applyToWorld();
      this.menus.hideLoading();
      this.state = previous;
      this.#setState(previous === "loading" ? "menu" : previous);
      await this.#refreshWorlds();
    }
  }

  async #refreshWorlds() {
    if (!this.worldManager) return;
    try {
      const worlds = await this.worldManager.listWorlds();
      const current = this.worldManager.current;
      this.menus.setWorlds(worlds, current?.id, current?.name ?? "");
    } catch (error) {
      this.hud.toast(`Couldn't list worlds: ${error.message}`, "error");
    }
  }

  async #save({ announce }) {
    if (!this.worldManager) return;
    try {
      await this.worldManager.save();
      if (announce) this.hud.toast("World saved");
      await this.#refreshWorlds();
    } catch {
      // Reported through the save status listener
    }
  }

  #toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      document.documentElement.requestFullscreen?.()?.catch((error) => {
        this.hud.toast(`Fullscreen isn't available: ${error.message}`, "error");
      });
    }
  }

  #applySetting(key, value) {
    switch (key) {
      case "reach":
        this.building.targeting.reach = value;
        break;
      case "autosaveSeconds":
        this.worldManager?.setAutosaveInterval(value);
        break;
      case "historyLimit":
        this.building.history.limit = value;
        break;
      case "sensitivity":
        this.player.controls.pointerSpeed = value;
        break;
      case "fov":
        this.player.camera.fov = value;
        this.player.camera.updateProjectionMatrix();
        break;
      case "volume":
        this.sounds.volume = value;
        break;
      case "graphics":
        this.graphics.apply(value);
        break;
      case "adaptiveResolution":
        this.graphics.setAdaptive(value);
        break;
      case "ambientVolume":
        this.environment.ambience.setVolume(value);
        break;
      case "dayMinutes":
        this.environment.dayMinutes = value;
        break;
      case "showStats":
        this.performance.setVisible(value);
        // The existing position readout (#info) is a debugging aid too
        document.body.classList.toggle("show-coordinates", value || this.debug);
        break;
      case "showHelp":
        this.hud.setHelpVisible(value);
        break;
    }
  }

  //! Wiring

  #inputActions() {
    const report = (result, repeat = false) => {
      if (!result.ok && !repeat) this.hud.toast(result.error, "error");
    };
    return {
      back: () => {
        if (this.state === "freecam") return this.#setState("menu");
        if (this.state === "inventory") return this.#resume();
        if (this.menus.back() === "resume") this.#resume();
      },
      place: (repeat) => report(this.building.placeBlock(), repeat),
      remove: (repeat) => report(this.building.removeBlock(), repeat),
      pick: () => report(this.building.pickBlock()),
      undo: () => report(this.building.undo()),
      redo: () => report(this.building.redo()),
      save: () => this.#save({ announce: true }),
      selectSlot: (slot) => this.inventory.select(slot),
      scrollSlot: (delta) => this.inventory.selectNext(delta),
      toggleInventory: () => {
        if (this.state === "inventory") return this.#resume();
        this.#setState("inventory");
        if (this.player.controls.isLocked) this.player.controls.unlock();
      },
      toggleMode: () => {
        const mode = this.building.toggleMode();
        this.hud.setMode(mode);
        this.hud.toast(mode === "build" ? "Build mode" : "Explore mode: building disabled");
      },
      toggleHelp: () => this.settings.set("showHelp", !this.settings.get("showHelp")),
      toggleFullscreen: () => this.#toggleFullscreen(),
      respawn: () => this.worldManager?.spawnPlayer(),
      focusLost: (hidden) => {
        // Saving when the tab is hidden protects progress if it never comes back
        if (hidden) this.worldManager?.saveIfNeeded().catch(() => {});
      },
    };
  }

  #menuCallbacks(debug) {
    return {
      onResume: () => this.#resume(),
      onToggleFullscreen: () => this.#toggleFullscreen(),
      onSaveNow: () => this.#save({ announce: true }),
      onFreeCamera: debug ? () => this.#setState("freecam") : undefined,
      onOpenWorlds: () => this.#refreshWorlds(),
      onPickBlock: (blockId) => this.inventory.assign(blockId),
      onSettingChange: (key, value) => this.settings.set(key, value),
      onCreateWorld: (options) =>
        this.#withLoading("Creating world…", "Couldn't create the world", () =>
          this.worldManager.createWorld(options)
        ).then((ok) => ok && this.hud.toast(`Created “${this.worldManager.current.name}”`)),
      onLoadWorld: (id) =>
        this.#withLoading("Loading world…", "Couldn't load the world", () => this.worldManager.loadWorld(id)).then(
          (ok) => ok && this.hud.toast(`Loaded “${this.worldManager.current.name}”`)
        ),
      onDeleteWorld: async (id, name) => {
        const confirmed = await this.menus.confirm({
          title: "Delete world?",
          message: `“${name}” and all its builds will be permanently deleted.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!confirmed) return;
        const ok = await this.#withLoading("Deleting world…", "Couldn't delete the world", () =>
          this.worldManager.deleteWorld(id)
        );
        if (ok) this.hud.toast(`Deleted “${name}”`);
      },
      onResetWorld: async () => {
        const confirmed = await this.menus.confirm({
          title: "Reset this world?",
          message: "Every block you placed or removed in this world will be undone. This can't be reversed.",
          confirmLabel: "Reset world",
          danger: true,
        });
        if (!confirmed) return;
        const ok = await this.#withLoading("Resetting world…", "Couldn't reset the world", async () => {
          await this.worldManager.resetWorld();
          this.building.history.clear();
        });
        if (ok) this.hud.toast("World reset");
      },
    };
  }
}
