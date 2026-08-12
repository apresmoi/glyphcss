// Scratch verification: which new toWorld mapping reproduces the SAME on-screen
// col/row spread as the OLD X-up mapping, at the word-art page's fixed
// rotX=0,rotY=0 camera. Reimplements rotateVec3Voxcss + the ortho project()
// branch verbatim from packages/glyphcss/src/api/createGlyphCamera.ts.
const DEG = Math.PI / 180;

function rotateVec3Voxcss(v, rotXDeg, rotYDeg) {
  const cx = v[1], cy = v[0], cz = v[2];
  const rotYR = rotYDeg * DEG;
  const cosY = Math.cos(rotYR), sinY = Math.sin(rotYR);
  const rx = cx * cosY - cy * sinY;
  const ry = cx * sinY + cy * cosY;
  const rz = cz;
  const rotXR = rotXDeg * DEG;
  const cosX = Math.cos(rotXR), sinX = Math.sin(rotXR);
  const ry2 = ry * cosX - rz * sinX;
  const rz2 = ry * sinX + rz * cosX;
  return [rx, ry2, rz2];
}

function projectOrtho(v, rotX, rotY, distance = 1000, zoom = 1) {
  const r = rotateVec3Voxcss(v, rotX, rotY);
  const denom = distance - r[2];
  const perspScale = distance / denom;
  const screenPxX = r[0] * perspScale * zoom;
  const screenPxY = r[1] * perspScale * zoom;
  return [screenPxX, screenPxY];
}

// Sample points spanning a stand-in "H" glyph in the TYPE PLANE:
// px = width axis (rightward), py = height axis (up), font-space-ish.
const samples = [
  { name: "top-left-of-stem", px: -20, py: 40 },
  { name: "bottom-right-of-stem", px: 20, py: -40 },
  { name: "center", px: 0, py: 0 },
];
const depthFront = 10, depthBack = -10;

function report(label, toWorld) {
  console.log(`\n== ${label} (camera rotX=0, rotY=0) ==`);
  for (const s of samples) {
    for (const z of [depthFront, depthBack]) {
      const w = toWorld(s.px, s.py, z);
      const [cx, cy] = projectOrtho(w, 0, 0);
      console.log(`  ${s.name} z=${z}: world=${w.map((n)=>n.toFixed(2))} -> screenX=${cx.toFixed(2)} screenY=${cy.toFixed(2)}`);
    }
  }
}

// OLD (current) frame: toWorld(p, z) = [-p.y, p.x, z]
report("OLD X-up", (px, py, z) => [-py, px, z]);

// Candidate A (literal task instruction): height->Z, width->X, depth->Y(negated for det parity)
report("Candidate A: [px, -z, py]", (px, py, z) => [px, -z, py]);

// Candidate B: depth->X, width->Y, height->Z (det+1 cyclic form)
report("Candidate B: [z, px, py]", (px, py, z) => [z, px, py]);

// Also check candidate A/B at rotX=90, rotY=0 to see if height becomes visible there.
console.log("\n--- Candidate A at rotX=90 ---");
for (const s of samples) {
  const w = [s.px, -depthFront, s.py];
  const [cx, cy] = projectOrtho(w, 90, 0);
  console.log(`  ${s.name}: screenX=${cx.toFixed(2)} screenY=${cy.toFixed(2)}`);
}
console.log("\n--- Candidate B at rotX=90 ---");
for (const s of samples) {
  const w = [depthFront, s.px, s.py];
  const [cx, cy] = projectOrtho(w, 90, 0);
  console.log(`  ${s.name}: screenX=${cx.toFixed(2)} screenY=${cy.toFixed(2)}`);
}
