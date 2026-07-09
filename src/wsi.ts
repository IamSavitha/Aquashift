import type { DataCenter, HourlyWeather, StressReading, WeatherForecast } from "./types.js";

/**
 * Wet-bulb temperature from dry-bulb temp (°C) and relative humidity (%).
 * Stull (2011), "Wet-Bulb Temperature from Relative Humidity and Air Temperature",
 * J. Appl. Meteor. Climatol. Accurate to ~0.3°C for RH 5–99%, T -20–50°C.
 */
export function wetBulbC(tempC: number, rhPct: number): number {
  const T = tempC;
  const RH = Math.max(5, Math.min(99, rhPct));
  return (
    T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) +
    Math.atan(T + RH) -
    Math.atan(RH - 1.676331) +
    0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
    4.686035
  );
}

/**
 * Water Usage Effectiveness (liters of water per kWh of IT load).
 *
 * Model: evaporative cooling water use rises with wet-bulb temperature because
 * the cooling tower loses thermodynamic headroom. Below ~7°C wet-bulb, free
 * air cooling covers the load and water use is near zero (only humidification
 * / makeup water). Industry average WUE is ~1.8 L/kWh; hot-desert evaporative
 * sites exceed 3.5 L/kWh in summer.
 */
export function computeWue(dc: DataCenter, hour: HourlyWeather): number {
  const twb = wetBulbC(hour.tempC, hour.humidityPct);

  // base curve: L/kWh as a function of wet-bulb headroom
  let wue: number;
  if (twb <= 7) {
    wue = 0.15; // free cooling, makeup water only
  } else {
    // ~0.16 L/kWh per °C of wet-bulb above the free-cooling threshold
    wue = 0.15 + 0.16 * (twb - 7);
  }

  // cooling-type multiplier: evaporative is the thirstiest, air the least
  const coolingMult = { evaporative: 1.25, hybrid: 1.0, air: 0.7 }[dc.coolingType];
  wue *= coolingMult;

  // extreme dry-bulb heat forces extra evaporation regardless of wet-bulb
  if (hour.tempC > 38) wue *= 1 + (hour.tempC - 38) * 0.04;

  return Math.round(wue * 100) / 100;
}

/**
 * Water Stress Index, 0–10. Composite of:
 *  - live WUE (50%): how much water each kWh costs right now
 *  - drought factor (30%): long-term regional scarcity — a liter in Phoenix
 *    is not a liter in Dublin
 *  - grid carbon (20%): tiebreaker so shifts also favor cleaner grids
 */
export function computeWsi(dc: DataCenter, wue: number): number {
  const wueNorm = Math.min(wue / 4.0, 1); // 4 L/kWh = worst case
  const carbonNorm = Math.min(dc.gridCarbon / 600, 1);
  const wsi = 10 * (0.5 * wueNorm + 0.3 * dc.droughtFactor + 0.2 * carbonNorm);
  return Math.round(wsi * 10) / 10;
}

export function stressLevel(wsi: number): StressReading["level"] {
  if (wsi >= 7.5) return "critical";
  if (wsi >= 5.5) return "warning";
  if (wsi >= 3.5) return "elevated";
  return "normal";
}

export function scoreDataCenter(dc: DataCenter, forecast: WeatherForecast): StressReading {
  const now = forecast.hours[0];
  const wue = computeWue(dc, now);
  const wsi = computeWsi(dc, wue);
  const forecastWue = forecast.hours.map((h) => computeWue(dc, h));

  return {
    dcId: dc.id,
    time: now.time,
    tempC: now.tempC,
    humidityPct: now.humidityPct,
    wetBulbC: Math.round(wetBulbC(now.tempC, now.humidityPct) * 10) / 10,
    wue,
    wsi,
    level: stressLevel(wsi),
    forecastWue,
    peakForecastWue: Math.max(...forecastWue),
  };
}

export const LITERS_PER_GALLON = 3.785;
