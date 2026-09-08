import { it } from "vitest";
import { mapsCodec } from "./mapsUrlState";
it("decode", () => {
  const raw = "p3x6-yc1ady6-jrafbs36htt14E1b29zL18O34vgM1a1a1a1a1n1a1t1a1a1aJ1a1o1a";
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(mapsCodec.decode(raw), null, 1));
});
import { MAP_OSM_SUBLAYERS } from "./mapsOsm";
it("rows", () => {
  const mask = 6316;
  const dens = [1,1,1,1,2.3,1,2.9,1,1,1,1,2.4,1];
  MAP_OSM_SUBLAYERS.forEach((s, i) => {
    // eslint-disable-next-line no-console
    console.log(i, s.id, s.type, (mask >> i) & 1 ? "ON" : "off", dens[i]);
  });
});
