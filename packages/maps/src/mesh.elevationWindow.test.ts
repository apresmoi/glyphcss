/**
 * A `raster` layer's elevation window (`GlyphMapRasterLayer.minElevation`/
 * `maxElevation`, reaching the mesh as `GlyphMapPolygonsOptions`' own pair):
 * terrain outside the window is HELD AT the window edge, and only its
 * POSITION moves.
 *
 * This file pins the mesh-level half of that on REAL data. The tier-ladder
 * half — the reason the surface is clamped rather than cropped — is
 * `widget.reliefWindow.test.ts`.
 *
 * ## The fixture is real
 *
 * `TRENCH_BLOCK` is a literal 45x30 slice of the z4 ETOPO1 tile `4/9` that
 * `website/scripts/bake-geo-tiles.mjs` bakes — lon -78..-72.5 by lat
 * -18..-14.375 at the pyramid's own 0.125-degree vertex spacing, north row
 * first, whole metres exactly as the int16 payload holds them — because the
 * full pyramid under `website/public/data/geo-tiles/` is gitignored and so
 * cannot be a test dependency. It is the Peru-Chile trench beside the
 * Andes: the region "the sea is basically GREEN" was reported at, and the
 * hardest case this feature has, because it puts -7,169 m of ocean within a
 * few hundred km of +5,105 m of cordillera. 1,004 of its 1,350 samples are
 * below sea level.
 */
import { describe, expect, it } from "vitest";
import { glyphMapPolygons } from "./mesh";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { GlyphMapClassifiers } from "./classify";
import type { GlyphMapGeoTile } from "./tile";

const TERRAIN = ["#2a55a8", "#2f5a36", "#3f6b32", "#5f7536", "#86713f", "#9c7b50", "#b09471", "#cdb49a", "#f0f0f0"];

/** Real ETOPO1, as baked — see this file's header. */
const TRENCH_BLOCK: readonly (readonly number[])[] = [
  [-4281, -4397, -4473, -4477, -4643, -4845, -5064, -4975, -4533, -3520, -2963, -1958, -674, -301, -165, -54, 629, 516, 607, 357, 554, 764, 1479, 1319, 1941, 2517, 3218, 3628, 4140, 4297, 4216, 4196, 4363, 3500, 4338, 4440, 4226, 4106, 4504, 3851, 4016, 3938, 4368, 4599, 4530],
  [-4202, -4356, -4302, -4281, -4481, -4619, -4732, -5093, -5166, -4459, -3576, -2168, -1664, -416, -145, -106, -30, 906, 632, 267, 377, 463, 535, 639, 1817, 2452, 2547, 2816, 4041, 3742, 3679, 4209, 4368, 4655, 4206, 4388, 4525, 4165, 3751, 4594, 4708, 4576, 4372, 4706, 4798],
  [-4282, -4238, -4298, -4185, -4268, -4254, -4405, -4561, -4737, -4880, -3735, -2725, -1831, -1645, -279, -174, -126, 161, 547, 235, 313, 453, 277, 645, 672, 1495, 3032, 3571, 3763, 4072, 3183, 3673, 4156, 4432, 4521, 4394, 4439, 4449, 4232, 4690, 4688, 4804, 4942, 4874, 4832],
  [-4015, -4121, -4204, -4035, -4119, -4204, -4237, -4208, -4255, -4684, -4787, -3546, -2955, -2348, -1603, -454, -183, -99, 325, 360, 213, 459, 345, 450, 699, 1497, 2203, 3203, 3661, 3887, 3792, 2705, 3934, 4316, 4556, 4249, 4392, 4365, 4468, 4600, 4702, 4851, 4568, 4910, 5050],
  [-4218, -4178, -4141, -4101, -3948, -4012, -4020, -4015, -4003, -4086, -4684, -4536, -3821, -3303, -1997, -1654, -374, -177, -103, -74, 295, 201, 497, 426, 507, 1458, 1682, 2436, 3222, 3634, 2835, 3413, 4026, 3713, 4497, 4510, 3891, 3994, 4748, 4678, 4557, 5055, 4814, 4784, 5005],
  [-3838, -4091, -4087, -4049, -3835, -3561, -3846, -3622, -3672, -3795, -4032, -4505, -4708, -4007, -2614, -2301, -1540, -429, -194, -118, -42, 544, 1464, 569, 527, 930, 1496, 1886, 2233, 2606, 2073, 3510, 3384, 3690, 3680, 4097, 4145, 3565, 4724, 4543, 4874, 4723, 4893, 4842, 4538],
  [-4069, -3667, -3793, -3788, -3668, -3670, -3318, -3456, -3543, -3594, -3679, -4103, -4441, -4928, -3806, -3181, -2690, -1464, -904, -371, -142, 60, 561, 809, 582, 919, 1305, 1820, 956, 2110, 2536, 3294, 2609, 1970, 3241, 4001, 3909, 3906, 4262, 4702, 4613, 4077, 3515, 4772, 4744],
  [-3975, -3918, -3612, -3674, -3357, -3298, -3314, -3233, -3288, -3422, -3473, -3709, -3912, -4742, -4372, -3996, -2990, -2546, -1689, -1193, -718, -200, -4, 673, 625, 617, 1582, 1248, 1840, 2088, 947, 1637, 2793, 3555, 3320, 3315, 3560, 2485, 3183, 4654, 2050, 4041, 4932, 4927, 4661],
  [-3730, -3854, -3568, -3569, -3452, -3042, -2964, -3008, -3078, -3029, -3107, -3284, -3461, -3886, -4835, -5025, -4315, -3619, -2455, -1194, -876, -323, -203, 54, 426, 373, 471, 336, 1903, 1199, 2063, 2867, 3126, 3902, 3633, 3590, 3811, 4004, 2381, 2923, 4272, 5078, 4488, 4501, 4480],
  [-3832, -3632, -3463, -3371, -2927, -3081, -2961, -2919, -2905, -2941, -3001, -3184, -3387, -3730, -4181, -4986, -5221, -4335, -3324, -2426, -1516, -963, -1002, -527, -90, 123, 148, 209, 1176, 2064, 2545, 2699, 2285, 3493, 3026, 3461, 3411, 3919, 2292, 3068, 3654, 3376, 4622, 5105, 4909],
  [-3769, -3665, -3499, -3146, -2887, -2817, -2854, -2698, -2873, -2949, -2923, -3051, -3145, -3466, -3856, -4045, -4469, -5487, -4330, -3617, -3003, -2006, -1474, -1085, -906, -562, -99, 94, 84, 1323, 1449, 1391, 2268, 2951, 3028, 3110, 2934, 3004, 3508, 2281, 2502, 4364, 4506, 4117, 3303],
  [-3636, -3460, -3490, -3268, -3053, -2856, -2767, -2621, -2789, -2922, -2939, -3029, -3118, -3138, -3610, -3806, -4174, -4904, -5669, -4945, -3532, -2981, -1947, -1468, -1203, -1102, -1019, -200, -354, 751, 721, 1181, 1795, 1128, 2764, 2562, 2741, 1965, 2548, 1267, 2019, 3308, 3978, 3929, 2503],
  [-3561, -3397, -2998, -2989, -2619, -2726, -2682, -2633, -2593, -2774, -2593, -3026, -3186, -3214, -3451, -3402, -2739, -3885, -5388, -6012, -4814, -4051, -3585, -2756, -2203, -1710, -1856, -1130, -952, -454, -47, 237, 1128, 1948, 2159, 1766, 1597, 1977, 2080, 565, 1131, 2609, 3501, 2496, 1791],
  [-3404, -3196, -2868, -2702, -2728, -2552, -2470, -2510, -2468, -2647, -2848, -2653, -3214, -3207, -3378, -3456, -3779, -4065, -4849, -5591, -5880, -4971, -4765, -3653, -3257, -2311, -2060, -1701, -1097, -852, -283, -145, 142, 1559, 1579, 1449, 1798, 1973, 1733, 2153, 1637, 1899, 2327, 1987, 847],
  [-3129, -3054, -2817, -2585, -2637, -2622, -2588, -2545, -2597, -2669, -2928, -2902, -3188, -3340, -3396, -3558, -3984, -4044, -4520, -5084, -5490, -6396, -5652, -4446, -4025, -3000, -2938, -2320, -2088, -1916, -1249, -721, -330, 42, 1058, 862, 1282, 1437, 1624, 1810, 2071, 2088, 1961, 1771, 924],
  [-3121, -3073, -2823, -2720, -2556, -2671, -2708, -2236, -2689, -2804, -3011, -3085, -3332, -3463, -3590, -3574, -3846, -4266, -4243, -4125, -4846, -5783, -6119, -5827, -4917, -4026, -3276, -2707, -2828, -2467, -1955, -1376, -881, -390, -166, -51, 668, 1059, 586, 1406, 1543, 1632, 1597, 1562, 684],
  [-3043, -2981, -2831, -2678, -2664, -2661, -2615, -2843, -2629, -2824, -3087, -3213, -3344, -3613, -3727, -3740, -3927, -4300, -4266, -3969, -4313, -5111, -5651, -6257, -6115, -5114, -4497, -3944, -3449, -2884, -2502, -2029, -1474, -1240, -651, -598, -280, -99, 159, 144, 752, 1211, 1273, 937, 460],
  [-3055, -2993, -2887, -2857, -2778, -2747, -2576, -2684, -2916, -3010, -3163, -3280, -3338, -3687, -3745, -3898, -4197, -4325, -4113, -3335, -4003, -4858, -5155, -5478, -6251, -6057, -5572, -4736, -4199, -3428, -3239, -3048, -2638, -2081, -1851, -1525, -759, -244, -800, -129, 259, 446, 806, 256, 937],
  [-2928, -2909, -2774, -2398, -2595, -2680, -3037, -2809, -3043, -3284, -3300, -3357, -3494, -3820, -3923, -4009, -4115, -4291, -4335, -4174, -4306, -4562, -4711, -5003, -5513, -5998, -6740, -5894, -5227, -4890, -4282, -4055, -3505, -2911, -2597, -1905, -1664, -1672, -1185, -488, -333, -55, 4, 214, 500],
  [-2906, -2845, -2759, -2672, -2532, -2721, -3158, -3094, -3242, -3323, -3428, -3418, -3682, -3894, -4006, -4046, -4072, -4141, -4258, -3990, -4050, -4503, -4699, -4728, -5189, -5625, -6053, -6617, -6537, -5916, -5123, -4936, -4293, -3271, -3192, -2767, -2374, -1750, -1578, -1231, -835, -222, -82, -54, -110],
  [-3021, -3015, -2896, -2782, -2828, -3080, -3091, -3522, -3185, -3318, -3498, -3683, -3812, -3981, -4016, -3973, -4029, -4209, -4222, -4082, -4154, -4511, -4450, -4543, -4790, -5015, -5295, -5799, -5800, -6670, -7142, -5989, -5101, -4282, -3759, -3228, -2863, -2688, -2548, -1868, -1577, -900, -521, -315, -661],
  [-2853, -3028, -3045, -3037, -3131, -3258, -3141, -3488, -3456, -3294, -3439, -3881, -3957, -3989, -3906, -4119, -4178, -4406, -4396, -4217, -4008, -4376, -4400, -4481, -4620, -4762, -4933, -5175, -5568, -6247, -6943, -7169, -6066, -5189, -4681, -3804, -3750, -3194, -3150, -2928, -2130, -1243, -827, -793, -1248],
  [-3084, -3023, -3153, -3052, -3222, -3284, -3173, -3584, -3620, -3592, -3572, -3931, -4003, -3955, -4023, -4106, -3849, -4181, -4344, -4188, -4151, -4334, -4340, -4472, -4538, -4692, -4723, -5094, -5206, -5599, -5977, -6881, -7078, -6467, -6500, -5024, -4610, -4654, -4368, -3433, -2053, -1702, -1321, -1260, -1445],
  [-3120, -3006, -3198, -3252, -3321, -3539, -3487, -3680, -3935, -3835, -3753, -4120, -4120, -4003, -4301, -4146, -4223, -3641, -4008, -4065, -4223, -4156, -4330, -4451, -4502, -4626, -4700, -4742, -4764, -5178, -5492, -5991, -6683, -6962, -6851, -5794, -5198, -4335, -4421, -3443, -2965, -2282, -1567, -1684, -1605],
  [-3115, -3027, -3301, -3513, -3439, -3665, -3600, -3688, -3862, -4210, -3960, -4213, -4257, -4208, -4374, -4383, -4369, -3989, -3960, -4287, -4336, -4254, -4350, -4145, -4068, -4602, -4666, -4566, -5019, -4781, -5119, -5452, -5690, -6073, -6665, -7078, -6883, -5430, -4918, -3930, -2982, -2659, -2720, -1146, -1139],
  [-3439, -3453, -3495, -3685, -3601, -3734, -3725, -3933, -3961, -4330, -4161, -4198, -4371, -4371, -4320, -4281, -4242, -4275, -4357, -4325, -4378, -4346, -4217, -4477, -4469, -4398, -4590, -4596, -4613, -4359, -4684, -5056, -5105, -5469, -6054, -6730, -6879, -6153, -5500, -4523, -3803, -3038, -2856, -1743, -1325],
  [-3707, -3770, -3879, -3833, -3710, -3763, -3817, -4033, -4126, -4243, -4227, -4177, -4581, -4332, -4575, -4353, -4078, -4315, -4571, -4422, -4409, -4314, -4301, -4501, -4491, -4386, -4210, -4274, -4527, -4387, -4362, -4826, -5055, -5340, -5578, -5992, -6546, -6875, -6824, -5589, -4452, -3817, -3444, -3248, -2494],
  [-3708, -3873, -3909, -4069, -3896, -3971, -3944, -4019, -4084, -4390, -4235, -4202, -4533, -4497, -4325, -4438, -4387, -4292, -4396, -4275, -4414, -4328, -4224, -4262, -4365, -4500, -4663, -4485, -4536, -4427, -4285, -4497, -4663, -4907, -4799, -4932, -5321, -6064, -6854, -6787, -5666, -4746, -3808, -3504, -3219],
  [-3791, -3875, -4170, -4129, -4057, -4122, -4036, -3933, -4053, -4541, -4281, -4223, -4427, -4362, -4275, -4356, -4442, -3902, -4548, -4684, -4443, -4276, -4323, -4625, -4473, -4269, -4474, -4411, -4484, -4235, -4085, -4352, -4380, -4147, -4373, -4770, -4986, -5382, -5722, -6826, -6823, -5947, -4949, -4566, -3834],
  [-4082, -4073, -4180, -4142, -4237, -4184, -4164, -4196, -4144, -4272, -4271, -4316, -4381, -4395, -4397, -4435, -4496, -4614, -4382, -4587, -4723, -4544, -4397, -4280, -4142, -4128, -4535, -4258, -4214, -4116, -4387, -4709, -4130, -4168, -4088, -4377, -4555, -4954, -5307, -5980, -6318, -6915, -6011, -5175, -4350],];

const BOUNDS = { west: -78, east: -72.5, south: -18, north: -14.375 } as const;

function trenchTile(): GlyphMapGeoTile {
  const rows = TRENCH_BLOCK.length - 1;
  const cols = TRENCH_BLOCK[0]!.length - 1;
  const elevation = new Float32Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) elevation[r * (cols + 1) + c] = TRENCH_BLOCK[r]![c]!;
  return { bounds: BOUNDS, cols, rows, elevation, source: "etopo1-fixture", sampler: "nearest" };
}

/** The per-band colour a real `/maps` terrain layer would hand `glyphMapPolygons`. */
function terrainColor(elev: number): string | undefined {
  const band = GlyphMapClassifiers.etopo1V1.classifyValue!(elev);
  return TERRAIN[band] ?? TERRAIN[TERRAIN.length - 1];
}

describe("glyphMapPolygons — the fixture itself", () => {
  it("is the real trench-and-cordillera block, not a synthetic ramp", () => {
    const tile = trenchTile();
    let below = 0, min = Infinity, max = -Infinity;
    for (const v of tile.elevation) { if (v < 0) below++; min = Math.min(min, v); max = Math.max(max, v); }
    expect({ n: tile.elevation.length, below, min, max }).toEqual({ n: 1350, below: 1004, min: -7169, max: 5105 });
  });
});

describe("glyphMapPolygons — an omitted window is byte-identical", () => {
  const tile = trenchTile();
  const base = glyphMapPolygons(tile, glyphMapEquirectangular({ exaggeration: 24 }), { color: terrainColor });

  it("declaring neither end changes nothing", () => {
    const both = glyphMapPolygons(tile, glyphMapEquirectangular({ exaggeration: 24 }), { color: terrainColor, minElevation: undefined, maxElevation: undefined });
    expect(both).toEqual(base);
  });

  it("an unbounded-in-practice window still changes nothing", () => {
    // -Infinity/Infinity are the internal resolution of "omitted"; a caller
    // handing numbers wider than the data must land on the same mesh.
    const wide = glyphMapPolygons(tile, glyphMapEquirectangular({ exaggeration: 24 }), { color: terrainColor, minElevation: -20000, maxElevation: 20000 });
    expect(wide).toEqual(base);
  });
});

describe("glyphMapPolygons — a floor of 0 drops the bathymetry and keeps the land", () => {
  const tile = trenchTile();
  const projection = glyphMapEquirectangular({ exaggeration: 24 });
  const base = glyphMapPolygons(tile, projection, { color: terrainColor });
  const floored = glyphMapPolygons(tile, projection, { color: terrainColor, minElevation: 0 });

  it("emits exactly the same quads — a clamp removes no surface", () => {
    expect(floored.length).toBe(base.length);
    expect(floored.length).toBeGreaterThan(1200);
  });

  it("puts every vertex where the same vertex clamped to the floor projects", () => {
    // Independently predicted from the tile's own samples, through the
    // projection itself — never read back off the mesh under test.
    const cols = tile.cols, rows = tile.rows;
    const dLon = (BOUNDS.east - BOUNDS.west) / cols;
    const dLat = (BOUNDS.north - BOUNDS.south) / rows;
    const wrong: string[] = [];
    let clamped = 0, untouched = 0;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const lon = BOUNDS.west + c * dLon;
        const lat = BOUNDS.north - r * dLat;
        const elev = tile.elevation[r * (cols + 1) + c]!;
        const want = projection.project(lon, lat, Math.max(0, elev));
        if (elev < 0) clamped++; else untouched++;
        // Find this vertex in the floored mesh: it is the nw corner of quad
        // (r, c) whenever both exist.
        if (r === rows || c === cols) continue;
        const quad = floored[r * cols + c]!;
        const nw = quad.vertices[0]!;
        const d = Math.hypot(nw[0] - want[0], nw[1] - want[1], nw[2] - want[2]);
        if (d > 1e-9 && wrong.length < 5) wrong.push(`(${c},${r}) elev=${elev} off by ${d}`);
      }
    }
    expect({ clamped, untouched, wrong }).toEqual({ clamped: 1004, untouched: 346, wrong: [] });
  });

  it("flattens the seabed onto one plane and leaves the cordillera alone", () => {
    const cols = tile.cols, rows = tile.rows;
    const seaZ = new Set<number>();
    let landMoved = 0, seaMoved = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const elev = tile.elevation[r * (cols + 1) + c]!;
        const a = base[r * cols + c]!.vertices[0]!;
        const b = floored[r * cols + c]!.vertices[0]!;
        if (elev >= 0) { if (a[2] !== b[2]) landMoved++; } else { seaMoved++; seaZ.add(b[2]); }
      }
    }
    // Every below-floor vertex lands on ONE plane, and no land vertex moved.
    expect({ landMoved, seaMoved, distinctSeaHeights: seaZ.size }).toEqual({ landMoved: 0, seaMoved: 949, distinctSeaHeights: 1 });
  });

  it("leaves every quad's colour exactly as the unwindowed mesh painted it", () => {
    // The window moves POSITION only; the classifier still sees the
    // terrain's own median. Clamping the colour too would hand band 0's
    // whole domain the value 0, and `etopo1V1`'s first break is 0 — every
    // ocean on Earth would come back in the lowest LAND colour.
    const baseColors = base.map((p) => p.color);
    const floorColors = floored.map((p) => p.color);
    expect(floorColors).toEqual(baseColors);
    // ...and that is not vacuous: the block really is mostly water.
    const water = baseColors.filter((c) => c === TERRAIN[0]).length;
    expect(water).toBeGreaterThan(700);
  });
});

describe("glyphMapPolygons — the window is per VERTEX, so a coast still slopes", () => {
  const tile = trenchTile();
  const projection = glyphMapEquirectangular({ exaggeration: 24 });
  const floored = glyphMapPolygons(tile, projection, { color: terrainColor, minElevation: 0 });

  it("keeps a partially-submerged quad's land corners at their own heights", () => {
    const cols = tile.cols, rows = tile.rows;
    let straddling = 0, flatStraddling = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const corners = [
          tile.elevation[r * (cols + 1) + c]!,
          tile.elevation[(r + 1) * (cols + 1) + c]!,
          tile.elevation[(r + 1) * (cols + 1) + c + 1]!,
          tile.elevation[r * (cols + 1) + c + 1]!,
        ];
        if (!(corners.some((e) => e < 0) && corners.some((e) => e >= 0))) continue;
        straddling++;
        const zs = new Set(floored[r * cols + c]!.vertices.map((v) => v[2]));
        if (zs.size === 1) flatStraddling++;
      }
    }
    // Every coastal quad still has relief: had the clamp been applied to a
    // quad STATISTIC, all four corners would move together and each of
    // these would be flat.
    expect(straddling).toBeGreaterThan(30);
    expect(flatStraddling).toBe(0);
  });
});

describe("glyphMapPolygons — the other end, and both", () => {
  const tile = trenchTile();
  const projection = glyphMapEquirectangular({ exaggeration: 24 });

  it("a ceiling of 0 flattens the land and keeps the trench", () => {
    const capped = glyphMapPolygons(tile, projection, { color: terrainColor, maxElevation: 0 });
    const base = glyphMapPolygons(tile, projection, { color: terrainColor });
    const cols = tile.cols, rows = tile.rows;
    let landMoved = 0, seaMoved = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const elev = tile.elevation[r * (cols + 1) + c]!;
      const moved = base[r * cols + c]!.vertices[0]![2] !== capped[r * cols + c]!.vertices[0]![2];
      if (elev > 0) { if (moved) landMoved++; } else if (moved) seaMoved++;
    }
    expect({ seaMoved, landMovedIsAllOfIt: landMoved > 300 }).toEqual({ seaMoved: 0, landMovedIsAllOfIt: true });
    expect(capped.map((p) => p.color)).toEqual(base.map((p) => p.color));
  });

  it("a floor above the ceiling renders one flat plane rather than throwing", () => {
    const inverted = glyphMapPolygons(tile, projection, { color: terrainColor, minElevation: 2000, maxElevation: 500 });
    expect(inverted.length).toBeGreaterThan(1200);
    const zs = new Set(inverted.flatMap((p) => p.vertices.map((v) => v[2])));
    // `Math.max` then `Math.min`: everything lands on the CEILING.
    expect(zs.size).toBe(1);
    expect([...zs][0]).toBe(projection.project(0, 0, 500)[2]);
  });
});

describe("glyphMapPolygons — the window rides the projection's own elevation axis", () => {
  it("means the same thing on the globe as on a sheet", () => {
    const tile = trenchTile();
    const globe = glyphMapGlobe({ exaggeration: 24 });
    const floored = glyphMapPolygons(tile, globe, { color: terrainColor, minElevation: 0 });
    const cols = tile.cols, rows = tile.rows;
    const dLon = (BOUNDS.east - BOUNDS.west) / cols;
    const dLat = (BOUNDS.north - BOUNDS.south) / rows;
    let checked = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const elev = tile.elevation[r * (cols + 1) + c]!;
      if (elev >= 0) continue;
      const want = globe.project(BOUNDS.west + c * dLon, BOUNDS.north - r * dLat, 0);
      const nw = floored[r * cols + c]!.vertices[0]!;
      expect(Math.hypot(nw[0] - want[0], nw[1] - want[1], nw[2] - want[2])).toBeLessThan(1e-12);
      checked++;
    }
    expect(checked).toBe(949);
  });
});
