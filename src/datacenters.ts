import type { DataCenter } from "./types.js";

export const DATA_CENTERS: DataCenter[] = [
  {
    id: "us-phoenix",
    name: "Phoenix, AZ",
    region: "us-west",
    lat: 33.4484,
    lon: -112.074,
    coolingType: "evaporative",
    droughtFactor: 0.9, // Colorado River basin, extreme baseline stress
    gridCarbon: 380,
    capacity: 100,
  },
  {
    id: "us-virginia",
    name: "Ashburn, VA",
    region: "us-east",
    lat: 39.0438,
    lon: -77.4874,
    coolingType: "hybrid",
    droughtFactor: 0.35,
    gridCarbon: 320,
    capacity: 100,
  },
  {
    id: "eu-dublin",
    name: "Dublin, IE",
    region: "eu-west",
    lat: 53.3498,
    lon: -6.2603,
    coolingType: "air", // free-air cooling viable most of the year
    droughtFactor: 0.15,
    gridCarbon: 290,
    capacity: 100,
  },
];

export const dcById = (id: string): DataCenter => {
  const dc = DATA_CENTERS.find((d) => d.id === id);
  if (!dc) throw new Error(`unknown data center: ${id}`);
  return dc;
};
