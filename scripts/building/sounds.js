//! Block sounds synthesised with Web Audio (no audio files needed)

// Band-pass filtered noise per material: centre frequency, sharpness, length
const PROFILES = {
  grass: { frequency: 700, q: 0.7, decay: 0.12 },
  sand: { frequency: 2600, q: 0.5, decay: 0.14 },
  stone: { frequency: 1500, q: 1.4, decay: 0.09 },
  wood: { frequency: 850, q: 3.5, decay: 0.1 },
  glass: { frequency: 4200, q: 6, decay: 0.25 },
  water: { frequency: 450, q: 2, decay: 0.3 },
};

export class BlockSounds {
  enabled = true;
  volume = 0.35;

  #context = null;
  #noise = null;

  /** @param {"place" | "break"} action */
  play(action, blockType) {
    if (!this.enabled || this.volume <= 0 || !blockType) return;
    const ctx = this.#getContext();
    if (!ctx) return;

    const profile = PROFILES[blockType.sound] ?? PROFILES.stone;
    const now = ctx.currentTime;

    if (action === "place") {
      this.#burst(ctx, profile, now, 1, 1);
      this.#thump(ctx, now);
    } else {
      // A few quick crackles read as "breaking"
      [0, 0.035, 0.08].forEach((delay, i) => {
        this.#burst(ctx, profile, now + delay, 1 - i * 0.25, 0.8 + Math.random() * 0.5);
      });
    }
  }

  dispose() {
    this.#context?.close();
    this.#context = null;
  }

  // Audio can only start after a user gesture, so create it lazily
  #getContext() {
    if (!this.#context) {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContext) return null;
      this.#context = new AudioContext();

      const length = this.#context.sampleRate * 0.5;
      this.#noise = this.#context.createBuffer(1, length, this.#context.sampleRate);
      const data = this.#noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.#context.state === "suspended") this.#context.resume();
    return this.#context;
  }

  #burst(ctx, profile, startTime, gainScale, pitch) {
    const source = ctx.createBufferSource();
    source.buffer = this.#noise;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = profile.frequency * pitch;
    filter.Q.value = profile.q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.volume * gainScale, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + profile.decay);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(startTime, Math.random() * 0.2);
    source.stop(startTime + profile.decay);
  }

  // Low "thud" that gives placement some weight
  #thump(ctx, startTime) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, startTime);
    osc.frequency.exponentialRampToValueAtTime(55, startTime + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.volume * 0.6, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.09);

    osc.connect(gain).connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.1);
  }
}
