import type { DataCenter, WeatherForecast, WeatherProvider } from "../types.js";

/**
 * Open-Meteo: free, no API key, hourly forecasts.
 * https://open-meteo.com/en/docs
 */
export class OpenMeteoProvider implements WeatherProvider {
  name = "open-meteo";

  async getForecast(dc: DataCenter): Promise<WeatherForecast> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${dc.lat}&longitude=${dc.lon}` +
      `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m&forecast_days=2&timezone=UTC`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`open-meteo ${res.status} for ${dc.id}`);
    const data = (await res.json()) as {
      hourly: {
        time: string[];
        temperature_2m: number[];
        relative_humidity_2m: number[];
        wind_speed_10m: number[];
      };
    };

    // slice from the current UTC hour forward, 6 hours
    const nowHour = new Date().toISOString().slice(0, 13);
    let start = data.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour);
    if (start < 0) start = 0;

    const hours = data.hourly.time.slice(start, start + 6).map((time, i) => ({
      time,
      tempC: data.hourly.temperature_2m[start + i],
      humidityPct: data.hourly.relative_humidity_2m[start + i],
      windKph: data.hourly.wind_speed_10m[start + i],
    }));

    return { dcId: dc.id, fetchedAt: new Date().toISOString(), source: this.name, hours };
  }
}
