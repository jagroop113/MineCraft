import * as THREE from "three";
import { SOLID } from "../blocks";
import { button, element } from "../building/ui/dom";

const _forward = new THREE.Vector3();

const JOYSTICK_RADIUS = 56;
const DEAD_ZONE = 0.12;
// Radians of view rotation per pixel dragged (before the sensitivity setting)
const LOOK_SPEED = 2.4;
const FIRST_REPEAT = 0.35;
const REPEAT = 0.22;

/**
 * On-screen controls for phones and tablets:
 * - left: a floating joystick for walking
 * - right: drag anywhere to look around; jump / sprint / place / break buttons
 * - top: pause, world information, settings and fullscreen
 * - bottom: an inventory button next to the (scrollable) hotbar
 *
 * Each finger is tracked by its touch identifier, so moving and looking (or
 * building) work at the same time. Touches are cancelled cleanly.
 */
export class TouchControls {
  enabled = false;

  #touches = new Map(); // identifier -> { role, x, y, action?, element? }
  #joystick = { x: 0, y: 0 };
  #held = null;
  #repeatTimer = 0;
  #abort = new AbortController();

  /**
   * @param {{
   *   root: HTMLElement, player: import("../player").Player, world: import("../world").World, isPlaying: () => boolean,
   *   actions: { place: (repeat: boolean) => void, remove: (repeat: boolean) => void,
   *              pause: () => void, settings: () => void, inventory: () => void, toggleFullscreen: () => void },
   * }} options
   */
  constructor({ root, player, world, isPlaying, actions }) {
    this.player = player;
    this.world = world;
    this.isPlaying = isPlaying;
    this.actions = actions;
    this.root = element("div", "touch-ui", root);

    const top = element("div", "touch-top", this.root);
    button(top, "❚❚", () => actions.pause(), "touch-round").setAttribute("aria-label", "Pause");
    this.info = element("div", "touch-info", top);
    button(top, "⚙", () => actions.settings(), "touch-round").setAttribute("aria-label", "Settings");
    if (document.fullscreenEnabled) {
      button(top, "⛶", () => actions.toggleFullscreen(), "touch-round").setAttribute("aria-label", "Fullscreen");
    }

    this.joystickZone = element("div", "touch-joystick-zone", this.root);
    this.joystickBase = element("div", "joystick-base", this.joystickZone);
    this.joystickKnob = element("div", "joystick-knob", this.joystickBase);
    this.lookZone = element("div", "touch-look-zone", this.root);

    const cluster = element("div", "touch-actions", this.root);
    this.buttons = {};
    for (const [action, label] of [["remove", "Break"], ["place", "Place"], ["sprint", "Run"], ["jump", "Jump"]]) {
      const el = element("div", `touch-button touch-${action}`, cluster, label);
      el.dataset.action = action;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", label);
      this.buttons[action] = el;
    }
    button(this.root, "▦", () => actions.inventory(), "touch-inventory touch-round").setAttribute("aria-label", "Inventory");

    const signal = this.#abort.signal;
    const options = { passive: false, signal };
    for (const zone of [this.joystickZone, this.lookZone, cluster]) {
      zone.addEventListener("touchstart", (event) => this.#onStart(event), options);
      zone.addEventListener("touchmove", (event) => this.#onMove(event), options);
      zone.addEventListener("touchend", (event) => this.#onEnd(event), options);
      zone.addEventListener("touchcancel", (event) => this.#onEnd(event), options);
    }
    // iOS pinch-zoom gestures would otherwise zoom the page
    document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false, signal });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    document.body.classList.toggle("touch-mode", enabled);
    if (!enabled) this.releaseAll();
  }

  setInfo(text) {
    if (this.info.textContent !== text) this.info.textContent = text;
  }

  /** Applies the joystick and repeats held build buttons */
  update(dt) {
    if (!this.enabled) return;
    if (!this.isPlaying()) {
      this.releaseAll();
      return;
    }
    if (this.#touches.size > 0 || this.#joystick.x || this.#joystick.y) {
      const speed = this.player.maxSpeed;
      this.player.input.x = this.#joystick.x * speed;
      this.player.input.z = -this.#joystick.y * speed;
      this.#autoJump();
    }
    if (this.#held) {
      this.#repeatTimer -= dt;
      if (this.#repeatTimer <= 0) {
        this.#repeatTimer = REPEAT;
        this.actions[this.#held](true);
      }
    }
  }

  /** Lets go of every touch (pause, focus loss, touchcancel) */
  releaseAll() {
    this.#touches.clear();
    this.#setJoystick(0, 0);
    this.player.input.set(0, 0, 0);
    this.#held = null;
    for (const el of Object.values(this.buttons)) if (el.dataset.action !== "sprint") el.classList.remove("pressed");
    this.joystickBase.classList.remove("active");
  }

  dispose() {
    this.#abort.abort();
    this.root.remove();
    document.body.classList.remove("touch-mode");
  }

  #onStart(event) {
    event.preventDefault(); // no scrolling, zooming or emulated mouse clicks
    if (!this.isPlaying()) return;
    for (const touch of event.changedTouches) {
      const target = touch.target instanceof Element ? touch.target : null;
      const actionButton = target?.closest(".touch-button");
      if (actionButton) {
        this.#press(touch.identifier, actionButton);
      } else if (target?.closest(".touch-joystick-zone") && ![...this.#touches.values()].some((t) => t.role === "joystick")) {
        // Floating joystick: centred wherever the thumb lands
        const zone = this.joystickZone.getBoundingClientRect();
        this.joystickBase.style.left = `${touch.clientX - zone.left}px`;
        this.joystickBase.style.top = `${touch.clientY - zone.top}px`;
        this.joystickBase.classList.add("active");
        this.#touches.set(touch.identifier, { role: "joystick", x: touch.clientX, y: touch.clientY });
      } else {
        this.#touches.set(touch.identifier, { role: "look", x: touch.clientX, y: touch.clientY });
      }
    }
  }

  #onMove(event) {
    event.preventDefault();
    for (const touch of event.changedTouches) {
      const state = this.#touches.get(touch.identifier);
      if (!state) continue;
      if (state.role === "joystick") {
        let dx = (touch.clientX - state.x) / JOYSTICK_RADIUS;
        let dy = (touch.clientY - state.y) / JOYSTICK_RADIUS;
        const length = Math.hypot(dx, dy);
        if (length > 1) {
          dx /= length;
          dy /= length;
        }
        this.#setJoystick(length < DEAD_ZONE ? 0 : dx, length < DEAD_ZONE ? 0 : dy);
      } else if (state.role === "look") {
        this.player.look((touch.clientX - state.x) * LOOK_SPEED, (touch.clientY - state.y) * LOOK_SPEED);
        state.x = touch.clientX;
        state.y = touch.clientY;
      }
    }
  }

  #onEnd(event) {
    // touchcancel isn't cancelable; touchend is (and must be, to stop emulated clicks)
    if (event.cancelable) event.preventDefault();
    for (const touch of event.changedTouches) {
      const state = this.#touches.get(touch.identifier);
      if (!state) continue;
      this.#touches.delete(touch.identifier);
      if (state.role === "joystick") {
        this.#setJoystick(0, 0);
        this.player.input.set(0, 0, 0);
        this.joystickBase.classList.remove("active");
      } else if (state.role === "button") {
        state.element.classList.remove("pressed");
        if (this.#held === state.action) this.#held = null;
      }
    }
  }

  #press(identifier, el) {
    const action = el.dataset.action;
    if (action === "sprint") {
      this.player.sprinting = !this.player.sprinting;
      el.classList.toggle("pressed", this.player.sprinting);
      return;
    }
    el.classList.add("pressed");
    this.#touches.set(identifier, { role: "button", action, element: el });
    if (action === "jump") {
      this.player.jump();
      return;
    }
    // Place / break act at once, then repeat while held (like holding the mouse)
    this.actions[action](false);
    this.#held = action;
    this.#repeatTimer = FIRST_REPEAT;
  }

  /**
   * Hops up one-block steps while walking with the joystick (there is no jump
   * key under the thumb that steers), as long as there is headroom above.
   */
  #autoJump() {
    const player = this.player;
    const { x: jx, y: jy } = this.#joystick;
    if (!player.onGround || Math.hypot(jx, jy) < 0.3) return;
    player.camera.getWorldDirection(_forward);
    _forward.y = 0;
    _forward.normalize();
    // Joystick up = forward, right = forward rotated a quarter turn
    const mx = _forward.x * -jy + -_forward.z * jx;
    const mz = _forward.z * -jy + _forward.x * jx;
    const length = Math.hypot(mx, mz) || 1;
    const p = player.position;
    const ax = Math.round(p.x + (mx / length) * 0.9);
    const az = Math.round(p.z + (mz / length) * 0.9);
    const feet = Math.round(p.y - player.height + 0.5);
    const solid = (x, y, z) => SOLID[this.world.getBlockId(x, y, z)] === 1;
    if (solid(ax, feet, az) && !solid(ax, feet + 1, az) && !solid(ax, feet + 2, az) && !solid(Math.round(p.x), feet + 2, Math.round(p.z))) {
      player.jump();
    }
  }

  #setJoystick(x, y) {
    this.#joystick.x = x;
    this.#joystick.y = y;
    this.joystickKnob.style.transform = `translate(${x * JOYSTICK_RADIUS}px, ${y * JOYSTICK_RADIUS}px)`;
  }
}
