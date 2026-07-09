import type { DataCenter, WeatherForecast, WeatherProvider } from "../types.js";

/**
 * Jua AI adapter — drop-in replacement for OpenMeteoProvider once you have a key.
 *
 * IMPORTANT: the endpoint/response shape below is a SKETCH. Verify against the
 * real Jua docs when you get API access (the earlier chat's claims about
 * query.jua.ai may be inaccurate). Only this file needs to change.
 */
export class JuaProvider implements WeatherProvider {
  name = "jua";

  constructor(private apiKey: string) {}

  async getForecast(dc: DataCenter): Promise<WeatherForecast> {
    const res = await fetch("https://api.jua.ai/v1/forecast", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        latitude: dc.lat,
        longitude: dc.lon,
        variables: ["temperature_2m", "relative_humidity_2m", "wind_speed_10m"],
        hours: 6,
      }),
    });
    if (!res.ok) throw new Error(`jua ${res.status} for ${dc.id}`);
    const data = await res.json();

    // TODO: map the real Jua response into HourlyWeather[] here.
    throw new Error("JuaProvider: response mapping not implemented — verify docs first");
  }
}
