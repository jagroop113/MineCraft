//! Ambient soundscape, synthesised with Web Audio (no audio files needed):
//! wind, rain, nearby water, birdsong by day, crickets at night and thunder.

export class Ambience {
  volume = 0.5;
  #ctx = null;
  #master = null;
  #loops = {};
  #birdTimer = 2;

  /** Audio can only start after a user gesture (e.g. pressing Play) */
  start() {
    if (this.#ctx) {
      if (this.#ctx.state === "suspended") this.#ctx.resume();
      return;
    }
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = (this.#ctx = new AudioContext());
    this.#master = ctx.createGain();
    this.#master.gain.value = this.volume;
    this.#master.connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;

    // Continuous layers: looping noise through a filter into a gain we fade
    const loop = (type, frequency, q) => {
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.#master);
      source.start();
      return { gain, filter };
    };
    this.#loops.wind = loop("bandpass", 380, 0.6);
    this.#loops.rain = loop("highpass", 1400, 0.4);
    this.#loops.water = loop("bandpass", 700, 0.8);

    // Crickets: a high tone, amplitude-pulsed
    const cricket = ctx.createOscillator();
    cricket.frequency.value = 4400;
    const pulse = ctx.createOscillator();
    pulse.frequency.value = 18;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    const cricketGain = ctx.createGain();
    cricketGain.gain.value = 0;
    const tremolo = ctx.createGain();
    tremolo.gain.value = 0.5;
    pulse.connect(pulseDepth).connect(tremolo.gain);
    cricket.connect(tremolo).connect(cricketGain).connect(this.#master);
    cricket.start();
    pulse.start();
    this.#loops.crickets = { gain: cricketGain };
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.#master) this.#master.gain.value = volume;
  }

  /**
   * @param {{ wind: number, rain: number, water: number, day: number, night: number, wildlife: boolean }} levels 0-1 each
   */
  update(dt, levels) {
    if (!this.#ctx || this.#ctx.state !== "running") return;
    const now = this.#ctx.currentTime;
    const fade = (name, value) => this.#loops[name].gain.gain.setTargetAtTime(value, now, 0.6);
    fade("wind", 0.03 + levels.wind * 0.16);
    this.#loops.wind.filter.frequency.setTargetAtTime(300 + levels.wind * 500, now, 1);
    fade("rain", levels.rain * 0.3);
    fade("water", levels.water * 0.32);
    fade("crickets", levels.wildlife ? levels.night * 0.018 : 0);

    if (levels.wildlife && levels.day > 0.6 && levels.rain < 0.3) {
      this.#birdTimer -= dt;
      if (this.#birdTimer <= 0) {
        this.#birdTimer = 2 + Math.random() * 5;
        this.#chirp(now);
      }
    }
  }

  thunder(delay = 0.6 + Math.random() * 1.5) {
    if (!this.#ctx || this.#ctx.state !== "running") return;
    const ctx = this.#ctx;
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.9, start + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 2.8);
    source.connect(filter).connect(gain).connect(this.#master);
    source.start(start);
    source.stop(start + 3);
  }

  #chirp(now) {
    const ctx = this.#ctx;
    const notes = 2 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1600;
    for (let i = 0; i < notes; i++) {
      const t = now + i * 0.13;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.07);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(gain).connect(this.#master);
      osc.start(t);
      osc.stop(t + 0.1);
    }
  }

  dispose() {
    this.#ctx?.close();
    this.#ctx = null;
  }
}
