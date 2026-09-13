#!/usr/bin/env node
"use strict";

/**
 * Street-scale car GLBs for the dash map.
 * Y-up, origin on the ground at the wheelbase center.
 * +Z is the nose (headlights), −Z is the tail.
 */
const fs = require("fs");
const path = require("path");

function hexRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

class Mesh {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.idx = [];
  }
  v(x, y, z, nx, ny, nz) {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    return i;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  addTri(p0, p1, p2) {
    const ax = p1[0] - p0[0];
    const ay = p1[1] - p0[1];
    const az = p1[2] - p0[2];
    const bx = p2[0] - p0[0];
    const by = p2[1] - p0[1];
    const bz = p2[2] - p0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    this.tri(this.v(p0[0], p0[1], p0[2], nx, ny, nz), this.v(p1[0], p1[1], p1[2], nx, ny, nz), this.v(p2[0], p2[1], p2[2], nx, ny, nz));
  }
  addQuad(p0, p1, p2, p3) {
    this.addTri(p0, p1, p2);
    this.addTri(p0, p2, p3);
  }
  addBox(cx, cy, cz, sx, sy, sz, rx, ry, rz) {
    rx = rx || 0;
    ry = ry || 0;
    rz = rz || 0;
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const local = [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [hx, hy, hz],
      [-hx, hy, hz]
    ];
    const crx = Math.cos(rx);
    const srx = Math.sin(rx);
    const cry = Math.cos(ry);
    const sry = Math.sin(ry);
    const crz = Math.cos(rz);
    const srz = Math.sin(rz);
    const pts = local.map((p) => {
      let x = p[0];
      let y = p[1];
      let z = p[2];
      let y1 = y * crx - z * srx;
      let z1 = y * srx + z * crx;
      y = y1;
      z = z1;
      let x1 = x * cry + z * sry;
      z1 = -x * sry + z * cry;
      x = x1;
      z = z1;
      x1 = x * crz - y * srz;
      y1 = x * srz + y * crz;
      return [x1 + cx, y1 + cy, z1 + cz];
    });
    const faces = [
      [0, 1, 2, 3],
      [5, 4, 7, 6],
      [4, 0, 3, 7],
      [1, 5, 6, 2],
      [3, 2, 6, 7],
      [4, 5, 1, 0]
    ];
    faces.forEach((f) => this.addQuad(pts[f[0]], pts[f[1]], pts[f[2]], pts[f[3]]));
  }
  addCylinder(cx, cy, cz, r, h, seg, axis, cap) {
    axis = axis || "x";
    seg = seg || 16;
    const rings = [];
    for (let k = 0; k < 2; k++) {
      const t = k ? h / 2 : -h / 2;
      const ring = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        let x;
        let y;
        let z;
        if (axis === "x") {
          x = cx + t;
          y = cy + s * r;
          z = cz + c * r;
        } else if (axis === "y") {
          x = cx + c * r;
          y = cy + t;
          z = cz + s * r;
        } else {
          x = cx + c * r;
          y = cy + s * r;
          z = cz + t;
        }
        ring.push([x, y, z]);
      }
      rings.push(ring);
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.addQuad(rings[0][i], rings[0][j], rings[1][j], rings[1][i]);
    }
    if (cap !== false) {
      for (let i = 1; i < seg - 1; i++) this.addTri(rings[0][0], rings[0][i + 1], rings[0][i]);
      for (let i = 1; i < seg - 1; i++) this.addTri(rings[1][0], rings[1][i], rings[1][i + 1]);
    }
  }
  addLoft(stations, segs) {
    const rings = stations.map((st) => roundedRing(st.z, st.y0, st.y1, st.w, st.rBot, st.rTop, segs));
    for (let s = 0; s < rings.length - 1; s++) {
      const a = rings[s];
      const b = rings[s + 1];
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % segs;
        this.addQuad(a[i], a[j], b[j], b[i]);
      }
    }
    capRing(this, rings[0], false);
    capRing(this, rings[rings.length - 1], true);
  }
}

function roundedRing(z, y0, y1, halfW, rBot, rTop, segs) {
  const h = Math.max(0.08, y1 - y0);
  const hw = Math.max(0.08, halfW);
  rBot = clamp(rBot == null ? 0.08 : rBot, 0.02, Math.min(hw * 0.92, h * 0.42));
  rTop = clamp(rTop == null ? 0.14 : rTop, 0.02, Math.min(hw * 0.92, h * 0.48));
  const corners = [
    { x: hw - rBot, y: y0 + rBot, r: rBot, a0: -Math.PI / 2, a1: 0 },
    { x: hw - rTop, y: y1 - rTop, r: rTop, a0: 0, a1: Math.PI / 2 },
    { x: -(hw - rTop), y: y1 - rTop, r: rTop, a0: Math.PI / 2, a1: Math.PI },
    { x: -(hw - rBot), y: y0 + rBot, r: rBot, a0: Math.PI, a1: Math.PI * 1.5 }
  ];
  const each = Math.max(2, Math.round(segs / 4));
  const pts = [];
  corners.forEach((c) => {
    for (let i = 0; i < each; i++) {
      const t = i / each;
      const a = c.a0 + (c.a1 - c.a0) * t;
      pts.push([c.x + Math.cos(a) * c.r, c.y + Math.sin(a) * c.r, z]);
    }
  });
  while (pts.length > segs) pts.pop();
  while (pts.length < segs) pts.push(pts[pts.length - 1]);
  return pts;
}

function capRing(mesh, ring, outwardPlusZ) {
  const n = ring.length;
  const c = [0, 0, 0];
  ring.forEach((p) => {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  });
  c[0] /= n;
  c[1] /= n;
  c[2] /= n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (outwardPlusZ) mesh.addTri(c, ring[i], ring[j]);
    else mesh.addTri(c, ring[j], ring[i]);
  }
}

function sampleKeys(keys, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    let k = 0;
    while (k < keys.length - 2 && u > keys[k + 1].t) k++;
    const a = keys[k];
    const b = keys[k + 1];
    const span = b.t - a.t || 1;
    const tt = smooth(clamp((u - a.t) / span, 0, 1));
    out.push({
      z: lerp(a.z, b.z, tt),
      y0: lerp(a.y0, b.y0, tt),
      y1: lerp(a.y1, b.y1, tt),
      w: lerp(a.w, b.w, tt),
      rBot: lerp(a.rBot, b.rBot, tt),
      rTop: lerp(a.rTop, b.rTop, tt)
    });
  }
  return out;
}

function bodyKeys(car) {
  const L = car.L;
  const H = car.H;
  const W = car.W * 0.5;
  const sill = 0.15;
  const hood = car.hood;
  const roof = H * 0.985;
  const z0 = -L * 0.5;
  const z1 = L * 0.5;
  const kind = car.kind;
  const rB = 0.07;
  const rT = kind === "sedan" || kind === "hatch" ? 0.16 : 0.13;

  const keys = [
    { t: 0, z: z0, y0: 0.2, y1: kind === "sedan" ? hood * 0.72 : hood * 0.78, w: W * 0.78, rBot: 0.05, rTop: 0.08 }
  ];

  if (kind === "sedan") {
    keys.push(
      { t: 0.08, z: z0 + L * 0.08, y0: sill, y1: hood * 0.92, w: W * 0.96, rBot: rB, rTop: 0.1 },
      { t: 0.2, z: z0 + L * 0.22, y0: sill, y1: hood * 1.02, w: W, rBot: rB, rTop: 0.11 },
      { t: 0.3, z: z0 + L * 0.32, y0: sill, y1: roof * 0.9, w: W * 0.97, rBot: rB, rTop: rT },
      { t: 0.42, z: z0 + L * 0.44, y0: sill, y1: roof, w: W * 0.95, rBot: rB, rTop: rT },
      { t: 0.58, z: z0 + L * 0.6, y0: sill, y1: roof * 0.99, w: W * 0.95, rBot: rB, rTop: rT },
      { t: 0.7, z: z0 + L * 0.72, y0: sill, y1: hood * 1.12, w: W * 0.98, rBot: rB, rTop: 0.12 },
      { t: 0.84, z: z0 + L * 0.86, y0: sill + 0.02, y1: hood, w: W * 0.97, rBot: rB, rTop: 0.1 },
      { t: 1, z: z1, y0: 0.2, y1: hood * 0.78, w: W * 0.8, rBot: 0.05, rTop: 0.08 }
    );
  } else if (kind === "hatch") {
    keys.push(
      { t: 0.07, z: z0 + L * 0.07, y0: sill, y1: hood * 1.05, w: W * 0.95, rBot: rB, rTop: 0.1 },
      { t: 0.16, z: z0 + L * 0.16, y0: sill, y1: roof * 0.86, w: W * 0.98, rBot: rB, rTop: rT },
      { t: 0.32, z: z0 + L * 0.34, y0: sill, y1: roof, w: W * 0.96, rBot: rB, rTop: rT },
      { t: 0.55, z: z0 + L * 0.56, y0: sill, y1: roof * 0.99, w: W * 0.95, rBot: rB, rTop: rT },
      { t: 0.7, z: z0 + L * 0.7, y0: sill, y1: hood * 1.18, w: W * 0.97, rBot: rB, rTop: 0.12 },
      { t: 0.86, z: z0 + L * 0.86, y0: sill + 0.02, y1: hood, w: W * 0.96, rBot: rB, rTop: 0.1 },
      { t: 1, z: z1, y0: 0.2, y1: hood * 0.8, w: W * 0.8, rBot: 0.05, rTop: 0.08 }
    );
  } else if (kind === "mpv") {
    keys.push(
      { t: 0.06, z: z0 + L * 0.06, y0: sill, y1: roof * 0.78, w: W * 0.94, rBot: rB, rTop: 0.1 },
      { t: 0.16, z: z0 + L * 0.16, y0: sill, y1: roof * 0.97, w: W * 0.98, rBot: rB, rTop: rT },
      { t: 0.5, z: z0 + L * 0.5, y0: sill, y1: roof, w: W * 0.97, rBot: rB, rTop: rT },
      { t: 0.72, z: z0 + L * 0.72, y0: sill, y1: roof * 0.96, w: W * 0.96, rBot: rB, rTop: rT },
      { t: 0.84, z: z0 + L * 0.84, y0: sill + 0.02, y1: hood * 1.08, w: W * 0.95, rBot: rB, rTop: 0.1 },
      { t: 0.93, z: z0 + L * 0.93, y0: sill + 0.03, y1: hood, w: W * 0.9, rBot: 0.06, rTop: 0.09 },
      { t: 1, z: z1, y0: 0.22, y1: hood * 0.82, w: W * 0.78, rBot: 0.05, rTop: 0.07 }
    );
  } else {
    keys.push(
      { t: 0.07, z: z0 + L * 0.07, y0: sill + 0.02, y1: hood * 1.15, w: W * 0.94, rBot: rB, rTop: 0.1 },
      { t: 0.18, z: z0 + L * 0.18, y0: sill, y1: roof * 0.92, w: W * 0.99, rBot: rB, rTop: rT },
      { t: 0.4, z: z0 + L * 0.4, y0: sill, y1: roof, w: W * 0.98, rBot: rB, rTop: rT },
      { t: 0.62, z: z0 + L * 0.62, y0: sill, y1: roof * 0.99, w: W * 0.97, rBot: rB, rTop: rT },
      { t: 0.78, z: z0 + L * 0.78, y0: sill + 0.02, y1: hood * 1.2, w: W * 0.97, rBot: rB, rTop: 0.11 },
      { t: 0.9, z: z0 + L * 0.9, y0: sill + 0.03, y1: hood, w: W * 0.94, rBot: 0.06, rTop: 0.09 },
      { t: 1, z: z1, y0: 0.22, y1: hood * 0.84, w: W * 0.8, rBot: 0.05, rTop: 0.07 }
    );
  }
  return keys;
}

function pinchArches(stations, car) {
  const wb = car.wb / 2;
  const wr = car.wr;
  stations.forEach((st) => {
    const near = Math.min(Math.abs(st.z - wb), Math.abs(st.z + wb));
    if (near < wr * 1.35) {
      const k = 1 - near / (wr * 1.35);
      st.y0 = Math.max(st.y0, lerp(st.y0, wr * 0.92, k * k));
      st.w += wr * 0.08 * k;
    }
  });
}

const CARS = {
  verso: {
    name: "Mini Verso",
    paint: "#d5d8df",
    trim: "#2a2e33",
    L: 4.14,
    W: 1.7,
    H: 1.64,
    wb: 2.55,
    wr: 0.32,
    ww: 0.22,
    hood: 0.86,
    kind: "mpv"
  },
  scross: {
    name: "Mini SX4 S-Cross",
    paint: "#f2eee6",
    trim: "#1b1d20",
    L: 4.3,
    W: 1.78,
    H: 1.58,
    wb: 2.6,
    wr: 0.33,
    ww: 0.23,
    hood: 0.84,
    kind: "crossover"
  },
  bmw3: {
    name: "Mini 3er / M3",
    paint: "#8d97a4",
    trim: "#111318",
    L: 4.64,
    W: 1.82,
    H: 1.43,
    wb: 2.81,
    wr: 0.325,
    ww: 0.24,
    hood: 0.72,
    kind: "sedan"
  },
  merc_e: {
    name: "Mini E-Class",
    paint: "#1a1d24",
    trim: "#0c0d10",
    L: 4.88,
    W: 1.85,
    H: 1.46,
    wb: 2.94,
    wr: 0.33,
    ww: 0.24,
    hood: 0.74,
    kind: "sedan"
  },
  korando: {
    name: "Mini Korando",
    paint: "#5f6673",
    trim: "#1a1c1f",
    L: 4.48,
    W: 1.86,
    H: 1.68,
    wb: 2.67,
    wr: 0.34,
    ww: 0.24,
    hood: 0.9,
    kind: "suv"
  },
  golf: {
    name: "Mini Golf",
    paint: "#b4231a",
    trim: "#141518",
    L: 4.28,
    W: 1.79,
    H: 1.48,
    wb: 2.62,
    wr: 0.32,
    ww: 0.23,
    hood: 0.76,
    kind: "hatch"
  }
};

function addWheel(rubber, chrome, dark, x, y, z, r, w) {
  rubber.addCylinder(x, y, z, r, w, 18, "x");
  rubber.addCylinder(x, y, z, r * 0.72, w * 0.55, 14, "x", false);
  chrome.addCylinder(x, y, z, r * 0.7, w * 0.42, 16, "x");
  dark.addCylinder(x, y, z, r * 0.22, w * 0.5, 10, "x");
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    chrome.addBox(x, y + Math.sin(a) * r * 0.34, z + Math.cos(a) * r * 0.34, w * 0.16, 0.045, r * 0.52, 0, a, 0);
  }
}

function addGlass(glass, car) {
  const L = car.L;
  const W = car.W * 0.5;
  const H = car.H;
  const hood = car.hood;
  const roof = H * 0.93;
  const cabinZ0 = car.kind === "mpv" || car.kind === "suv" ? -L * 0.36 : car.kind === "hatch" ? -L * 0.32 : -L * 0.22;
  const cabinZ1 = car.kind === "mpv" ? L * 0.22 : L * 0.18;
  glass.addBox(0, (hood + roof) * 0.52, (cabinZ0 + cabinZ1) * 0.5, W * 1.52, (roof - hood) * 0.72, Math.abs(cabinZ1 - cabinZ0) * 0.72);
  const wsZ = car.kind === "mpv" ? L * 0.26 : L * 0.3;
  const wsTilt = car.kind === "sedan" ? 0.52 : 0.44;
  glass.addBox(0, hood + (roof - hood) * 0.42, wsZ, W * 1.48, (roof - hood) * 0.7, L * 0.14, wsTilt, 0, 0);
  const rwZ = car.kind === "sedan" ? -L * 0.28 : -L * 0.36;
  const rwTilt = car.kind === "sedan" ? -0.48 : car.kind === "hatch" ? -0.38 : -0.22;
  glass.addBox(0, hood + (roof - hood) * 0.4, rwZ, W * 1.46, (roof - hood) * 0.66, L * 0.12, rwTilt, 0, 0);
}

function addMirrors(paint, glass, car) {
  const W = car.W * 0.5;
  const y = car.hood + 0.06;
  const z = car.L * (car.kind === "mpv" ? 0.16 : 0.2);
  [-1, 1].forEach((s) => {
    paint.addBox(s * (W + 0.08), y, z, 0.16, 0.09, 0.22);
    glass.addBox(s * (W + 0.1), y + 0.01, z - 0.01, 0.04, 0.07, 0.16);
  });
}

function brandFace(id, car, paint, glass, chrome, dark, lightR, lightA) {
  const L = car.L;
  const W = car.W * 0.5;
  const hood = car.hood;
  const nose = L * 0.5;
  const tail = -L * 0.5;
  const wr = car.wr;

  paint.addBox(0, 0.08, 0, W * 1.55, 0.08, L * 0.72);
  dark.addBox(0, 0.05, 0, W * 1.35, 0.04, L * 0.62);

  if (id === "verso") {
    chrome.addBox(0, 0.42, nose - 0.01, W * 1.42, 0.05, 0.04);
    dark.addBox(0, 0.52, nose - 0.01, W * 1.12, 0.22, 0.05);
    lightA.addBox(W * 0.62, 0.5, nose + 0.01, 0.38, 0.16, 0.08);
    lightA.addBox(-W * 0.62, 0.5, nose + 0.01, 0.38, 0.16, 0.08);
    lightR.addBox(W * 0.68, 0.72, tail + 0.01, 0.22, 0.42, 0.08);
    lightR.addBox(-W * 0.68, 0.72, tail + 0.01, 0.22, 0.42, 0.08);
    chrome.addBox(0, car.H * 0.98, -0.04, W * 0.7, 0.03, L * 0.42);
    paint.addBox(0, car.H * 0.99, -0.02, W * 1.15, 0.06, L * 0.5);
  } else if (id === "scross") {
    chrome.addBox(0, 0.4, nose, W * 1.5, 0.06, 0.05);
    dark.addBox(0, 0.52, nose, W * 1.08, 0.18, 0.05);
    chrome.addBox(0, 0.48, nose + 0.02, W * 0.86, 0.02, 0.03);
    chrome.addBox(0, 0.54, nose + 0.02, W * 0.86, 0.02, 0.03);
    lightA.addBox(W * 0.68, 0.5, nose + 0.01, 0.34, 0.14, 0.07);
    lightA.addBox(-W * 0.68, 0.5, nose + 0.01, 0.34, 0.14, 0.07);
    lightR.addBox(0, 0.58, tail + 0.01, W * 1.42, 0.07, 0.05);
    lightR.addBox(W * 0.66, 0.58, tail + 0.01, 0.36, 0.16, 0.07);
    lightR.addBox(-W * 0.66, 0.58, tail + 0.01, 0.36, 0.16, 0.07);
    dark.addBox(0, wr * 0.55, 0, W * 1.72, wr * 0.42, L * 0.78);
  } else if (id === "bmw3") {
    chrome.addBox(0.16, 0.4, nose, 0.26, 0.22, 0.06, 0, 0, 0.18);
    chrome.addBox(-0.16, 0.4, nose, 0.26, 0.22, 0.06, 0, 0, -0.18);
    dark.addBox(0.16, 0.4, nose + 0.02, 0.18, 0.16, 0.04, 0, 0, 0.18);
    dark.addBox(-0.16, 0.4, nose + 0.02, 0.18, 0.16, 0.04, 0, 0, -0.18);
    lightA.addBox(W * 0.72, 0.46, nose + 0.01, 0.36, 0.1, 0.06);
    lightA.addBox(-W * 0.72, 0.46, nose + 0.01, 0.36, 0.1, 0.06);
    lightR.addBox(W * 0.7, 0.5, tail + 0.01, 0.4, 0.1, 0.06);
    lightR.addBox(-W * 0.7, 0.5, tail + 0.01, 0.4, 0.1, 0.06);
    lightR.addBox(W * 0.84, 0.42, tail + 0.01, 0.1, 0.26, 0.05);
    lightR.addBox(-W * 0.84, 0.42, tail + 0.01, 0.1, 0.26, 0.05);
    paint.addBox(0, hood + 0.02, tail + 0.18, W * 0.82, 0.05, 0.28);
    dark.addBox(W * 0.58, wr * 0.42, L * 0.28, 0.18, 0.12, 0.22);
    dark.addBox(-W * 0.58, wr * 0.42, L * 0.28, 0.18, 0.12, 0.22);
  } else if (id === "merc_e") {
    chrome.addBox(0, 0.46, nose, W * 1.28, 0.26, 0.05);
    dark.addBox(0, 0.46, nose + 0.02, W * 1.12, 0.2, 0.04);
    for (let i = -4; i <= 4; i++) chrome.addBox(i * 0.1, 0.46, nose + 0.03, 0.035, 0.18, 0.02);
    chrome.addCylinder(0, 0.58, nose + 0.04, 0.055, 0.03, 12, "z");
    lightA.addBox(W * 0.74, 0.46, nose + 0.01, 0.32, 0.09, 0.06);
    lightA.addBox(-W * 0.74, 0.46, nose + 0.01, 0.32, 0.09, 0.06);
    lightR.addBox(0, 0.54, tail + 0.01, W * 1.62, 0.07, 0.05);
    lightR.addBox(W * 0.76, 0.54, tail + 0.01, 0.3, 0.14, 0.06);
    lightR.addBox(-W * 0.76, 0.54, tail + 0.01, 0.3, 0.14, 0.06);
    chrome.addBox(0, hood * 0.7, 0, W * 1.78, 0.015, L * 0.55);
  } else if (id === "korando") {
    dark.addBox(0, 0.52, nose, W * 1.18, 0.24, 0.06);
    chrome.addBox(0, 0.38, nose, W * 1.42, 0.06, 0.05);
    lightA.addBox(W * 0.7, 0.56, nose + 0.01, 0.3, 0.16, 0.07);
    lightA.addBox(-W * 0.7, 0.56, nose + 0.01, 0.3, 0.16, 0.07);
    dark.addBox(0, wr * 0.55, 0, W * 1.78, wr * 0.48, L * 0.8);
    lightR.addBox(W * 0.7, 0.7, tail + 0.01, 0.3, 0.22, 0.07);
    lightR.addBox(-W * 0.7, 0.7, tail + 0.01, 0.3, 0.22, 0.07);
    chrome.addBox(W * 0.42, car.H * 0.99, 0, 0.04, 0.04, L * 0.4);
    chrome.addBox(-W * 0.42, car.H * 0.99, 0, 0.04, 0.04, L * 0.4);
    paint.addBox(0, car.H * 0.995, 0, W * 1.12, 0.05, L * 0.46);
  } else if (id === "golf") {
    dark.addBox(0, 0.46, nose, W * 1.2, 0.2, 0.05);
    chrome.addBox(0, 0.36, nose, W * 1.38, 0.05, 0.05);
    chrome.addCylinder(0, 0.5, nose + 0.03, 0.05, 0.03, 12, "z");
    for (let i = -2; i <= 2; i++) chrome.addBox(0, 0.46 + i * 0.03, nose + 0.025, W * 0.72, 0.015, 0.02);
    lightA.addBox(W * 0.68, 0.48, nose + 0.01, 0.34, 0.12, 0.07);
    lightA.addBox(-W * 0.68, 0.48, nose + 0.01, 0.34, 0.12, 0.07);
    lightR.addBox(0, 0.58, tail + 0.01, W * 1.48, 0.08, 0.05);
    lightR.addBox(W * 0.66, 0.58, tail + 0.01, 0.42, 0.14, 0.07);
    lightR.addBox(-W * 0.66, 0.58, tail + 0.01, 0.42, 0.14, 0.07);
    paint.addBox(0, hood + 0.08, tail + 0.2, W * 1.05, 0.06, 0.2, 0.35, 0, 0);
  }

  dark.addBox(0, 0.28, tail + 0.02, 0.28, 0.12, 0.03);
  chrome.addBox(0, 0.28, tail + 0.035, 0.24, 0.09, 0.015);
  lightA.addBox(W * 0.48, wr * 0.62, nose - 0.02, 0.1, 0.07, 0.04);
  lightA.addBox(-W * 0.48, wr * 0.62, nose - 0.02, 0.1, 0.07, 0.04);
}

function buildCar(id, car) {
  const paint = new Mesh();
  const glass = new Mesh();
  const chrome = new Mesh();
  const dark = new Mesh();
  const rubber = new Mesh();
  const lightR = new Mesh();
  const lightA = new Mesh();

  const stations = sampleKeys(bodyKeys(car), 16);
  pinchArches(stations, car);
  paint.addLoft(stations, 20);

  addGlass(glass, car);
  addMirrors(paint, glass, car);

  const track = car.W * 0.5 * 0.82;
  const wb = car.wb / 2;
  [
    [track, car.wr, wb],
    [-track, car.wr, wb],
    [track, car.wr, -wb],
    [-track, car.wr, -wb]
  ].forEach((p) => addWheel(rubber, chrome, dark, p[0], p[1], p[2], car.wr, car.ww));

  brandFace(id, car, paint, glass, chrome, dark, lightR, lightA);

  const rgb = hexRgb(car.paint);
  const materials = [
    mat("paint", rgb, 0.22, 0.34),
    mat("glass", [0.1, 0.16, 0.24, 0.62], 0.08, 0.08, "BLEND"),
    mat("chrome", [0.86, 0.88, 0.92, 1], 0.72, 0.2),
    mat("trim", hexRgb(car.trim).concat([1]), 0.12, 0.58),
    mat("rubber", [0.07, 0.07, 0.07, 1], 0.04, 0.9),
    Object.assign(mat("tail", [0.82, 0.06, 0.07, 1], 0.18, 0.22), { emissiveFactor: [0.85, 0.08, 0.05] }),
    Object.assign(mat("head", [0.96, 0.97, 0.9, 1], 0.28, 0.12), { emissiveFactor: [0.95, 0.92, 0.75] })
  ];

  return assemble(id, car.name, [paint, glass, chrome, dark, rubber, lightR, lightA], materials);
}

function mat(name, color, metal, rough, alpha) {
  const base = color.length === 4 ? color : color.concat([1]);
  const m = {
    name,
    pbrMetallicRoughness: {
      baseColorFactor: base,
      metallicFactor: metal,
      roughnessFactor: rough
    },
    doubleSided: true
  };
  if (alpha) m.alphaMode = alpha;
  return m;
}

function concatMeshes(meshes) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const primitives = [];
  meshes.forEach((mesh, mi) => {
    if (!mesh.idx.length) return;
    const vOff = pos.length / 3;
    const iStart = idx.length;
    pos.push.apply(pos, mesh.pos);
    nrm.push.apply(nrm, mesh.nrm);
    mesh.idx.forEach((i) => idx.push(i + vOff));
    primitives.push({
      material: mi,
      vOff,
      vCount: mesh.pos.length / 3,
      iStart,
      iCount: mesh.idx.length
    });
  });
  return { pos, nrm, idx, primitives };
}

function assemble(id, name, meshes, materials) {
  const packed = concatMeshes(meshes);
  const pos = new Float32Array(packed.pos);
  const nrm = new Float32Array(packed.nrm);
  const use32 = packed.idx.length > 65535;
  const indices = use32 ? new Uint32Array(packed.idx) : new Uint16Array(packed.idx);
  const indexBytes = indices.byteLength;
  const indexPad = (4 - (indexBytes % 4)) % 4;
  const bin = Buffer.concat([
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength),
    Buffer.alloc(indexPad),
    Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength),
    Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength)
  ]);
  const posOff = indexBytes + indexPad;
  const nrmOff = posOff + pos.byteLength;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const indexSize = use32 ? 4 : 2;
  const accessors = [];
  packed.primitives.forEach((p) => {
    accessors.push({
      bufferView: 0,
      byteOffset: p.iStart * indexSize,
      componentType: use32 ? 5125 : 5123,
      count: p.iCount,
      type: "SCALAR"
    });
  });
  const primitives = packed.primitives.map((p, i) => ({
    attributes: { POSITION: packed.primitives.length, NORMAL: packed.primitives.length + 1 },
    indices: i,
    material: p.material,
    mode: 4
  }));
  accessors.push({
    bufferView: 1,
    componentType: 5126,
    count: pos.length / 3,
    type: "VEC3",
    min,
    max
  });
  accessors.push({
    bufferView: 2,
    componentType: 5126,
    count: nrm.length / 3,
    type: "VEC3"
  });
  const json = {
    asset: { version: "2.0", generator: "nav-cars" },
    scene: 0,
    scenes: [{ nodes: [0], name }],
    nodes: [{ mesh: 0, name: id }],
    meshes: [{ name: id, primitives }],
    materials,
    accessors,
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indexBytes, target: 34963 },
      { buffer: 0, byteOffset: posOff, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrm.byteLength, target: 34962 }
    ],
    buffers: [{ byteLength: bin.length }]
  };
  return { id, name, json, bin, min, max };
}

function writeGlb(file, json, bin) {
  json.buffers[0].byteLength = bin.length;
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonChunk.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binChunk.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([header, jh, jsonChunk, bh, binChunk]));
}

const outDir = __dirname;
Object.keys(CARS).forEach((id) => {
  const built = buildCar(id, CARS[id]);
  const file = path.join(outDir, id + ".glb");
  writeGlb(file, built.json, built.bin);
  console.log(
    id,
    fs.statSync(file).size,
    "bytes",
    CARS[id].name,
    "y",
    built.min[1].toFixed(3),
    "..",
    built.max[1].toFixed(3),
    "z",
    built.min[2].toFixed(3),
    "..",
    built.max[2].toFixed(3)
  );
});
