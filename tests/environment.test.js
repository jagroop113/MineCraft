import { describe, expect, it } from "vitest";
import { BIOME } from "../scripts/terrain/biomes";
import { WEATHER, WeatherState, formatTime, skyColor, sunState } from "../scripts/environment/weather";

describe("day / night", () => {
  it("puts the sun overhead at noon and below the horizon at midnight", () => {
    expect(sunState(0.5).elevation).toBeGreaterThan(0.9);
    expect(sunState(0).elevation).toBeLessThan(-0.9);
    expect(sunState(0.5).daylight).toBe(1);
    expect(sunState(0).daylight).toBe(0);
  });

  it("brightens through sunrise and has a twilight glow", () => {
    const times = [0.2, 0.23, 0.25, 0.27, 0.3, 0.35];
    const daylight = times.map((t) => sunState(t).daylight);
    for (let i = 1; i < daylight.length; i++) expect(daylight[i]).toBeGreaterThanOrEqual(daylight[i - 1]);
    expect(sunState(0.25).twilight).toBeGreaterThan(0.9);
    expect(sunState(0.5).twilight).toBe(0);
  });

  it("colours the sky: dark at night, blue at noon, warm at sunset", () => {
    const night = skyColor(sunState(0), WEATHER.clear);
    const noon = skyColor(sunState(0.5), WEATHER.clear);
    const sunset = skyColor(sunState(0.75), WEATHER.clear);
    const brightness = ([r, g, b]) => r + g + b;
    expect(brightness(noon)).toBeGreaterThan(brightness(night) * 3);
    expect(noon[2]).toBeGreaterThan(noon[0]); // blue
    expect(sunset[0]).toBeGreaterThan(sunset[2]); // orange
    expect(brightness(skyColor(sunState(0.5), WEATHER.thunderstorm))).toBeLessThan(brightness(noon));
  });

  it("formats the time of day", () => {
    expect(formatTime(0.5)).toBe("12:00");
    expect(formatTime(0.25)).toBe("06:00");
    expect(formatTime(0.999)).toBe("23:58");
  });
});

describe("weather", () => {
  it("transitions gradually towards new weather", () => {
    const weather = new WeatherState({ random: () => 0.5, minSeconds: 1000, maxSeconds: 1000 });
    weather.setWeather("rain");
    weather.update(1, BIOME.plains);
    expect(weather.params.rain).toBeGreaterThan(0);
    expect(weather.params.rain).toBeLessThan(0.3);
    for (let i = 0; i < 60; i++) weather.update(1, BIOME.plains);
    expect(weather.params.rain).toBeCloseTo(WEATHER.rain.rain, 1);
  });

  it("changes weather on its own over time", () => {
    let n = 0;
    const values = [0.0, 0.95, 0.4, 0.75, 0.1, 0.6];
    const weather = new WeatherState({ random: () => values[n++ % values.length], minSeconds: 10, maxSeconds: 20 });
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      weather.update(1, BIOME.forest);
      seen.add(weather.current);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("snows instead of raining in cold biomes", () => {
    const weather = new WeatherState({ minSeconds: 1000, maxSeconds: 1000 });
    weather.setWeather("rain", { immediate: true });
    weather.update(0.1, BIOME.snowyForest);
    expect(weather.current).toBe("snow");
    weather.update(0.1, BIOME.forest);
    expect(weather.current).toBe("rain");
  });

  it("follows the biome's weather table (no snow in deserts)", () => {
    const weather = new WeatherState({ random: Math.random });
    for (let i = 0; i < 500; i++) expect(weather.pickNext(BIOME.desert)).not.toBe("snow");
    expect(weather.pickNext(null)).toBeDefined();
  });

  it("loads saved weather immediately", () => {
    const weather = new WeatherState();
    weather.setWeather("thunderstorm", { immediate: true });
    expect(weather.params).toEqual(WEATHER.thunderstorm);
  });
});
