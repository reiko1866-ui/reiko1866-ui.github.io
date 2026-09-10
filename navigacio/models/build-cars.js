#!/usr/bin/env node
"use strict";

/**
 * Builds compact, brand-distinct GLB cars for the garage fleet.
 * Y-up, origin on the ground at the wheelbase center, nose toward -Z.
 */
const fs = require("fs");
const path = require("path");

function hexRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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
      x = x1 + cx;
      y = y1 + cy;
      z = z1 + cz;
      return [x, y, z];
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
    seg = seg || 18;
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
      const n = seg;
      for (let i = 1; i < n - 1; i++) this.addTri(rings[0][0], rings[0][i + 1], rings[0][i]);
      for (let i = 1; i < n - 1; i++) this.addTri(rings[1][0], rings[1][i], rings[1][i + 1]);
    }
  }
  addLoft(rings) {
    for (let s = 0; s < rings.length - 1; s++) {
      const a = rings[s];
      const b = rings[s + 1];
      const n = a.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.addQuad(a[i], a[j], b[j], b[i]);
      }
    }
  }
}

function roundedRing(cx, y0, cz, halfW, height, corner, segs) {
  segs = segs || 5;
  const hw = Math.max(0.04, halfW);
  const hh = Math.max(0.04, height);
  const r = Math.min(corner, hw * 0.9, hh * 0.9);
  const pts = [];
  function cornerArc(ox, oy, a0) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2);
      pts.push([cx + ox + Math.cos(a) * r, y0 + oy + Math.sin(a) * r, cz]);
    }
  }
  cornerArc(hw - r, hh - r, 0);
  cornerArc(-(hw - r), hh - r, Math.PI / 2);
  cornerArc(-(hw - r), r, Math.PI);
  cornerArc(hw - r, r, (Math.PI * 3) / 2);
  return pts;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sampleStations(spec, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const z = lerp(spec.z0, spec.z1, t);
    let key = spec.stations[0];
    for (let k = 1; k < spec.stations.length; k++) {
      if (t >= spec.stations[k - 1].t && t <= spec.stations[k].t) {
        const u = (t - spec.stations[k - 1].t) / Math.max(1e-6, spec.stations[k].t - spec.stations[k - 1].t);
        const a = spec.stations[k - 1];
        const b = spec.stations[k];
        key = {
          w: lerp(a.w, b.w, u),
          h: lerp(a.h, b.h, u),
          y: lerp(a.y, b.y, u),
          r: lerp(a.r, b.r, u)
        };
        break;
      }
      key = spec.stations[k];
    }
    out.push({ z, w: key.w, h: key.h, y: key.y, r: key.r });
  }
  return out;
}

const CARS = {
  verso: {
    name: "Toyota Corolla Verso",
    paint: "#c8ccd1",
    trim: "#2a2e33",
    length: 4.36,
    width: 1.77,
    height: 1.62,
    wheelbase: 2.75,
    wheelR: 0.33,
    ground: 0.16,
    body: "mpv"
  },
  scross: {
    name: "Suzuki SX4 S-Cross",
    paint: "#f3f1ea",
    trim: "#1b1d20",
    length: 4.3,
    width: 1.78,
    height: 1.58,
    wheelbase: 2.6,
    wheelR: 0.34,
    ground: 0.18,
    body: "crossover"
  },
  bmw3: {
    name: "BMW 3-as sorozat",
    paint: "#bec5ce",
    trim: "#111318",
    length: 4.63,
    width: 1.81,
    height: 1.43,
    wheelbase: 2.81,
    wheelR: 0.32,
    ground: 0.13,
    body: "sedan"
  },
  merc_e: {
    name: "Mercedes-Benz E-Class",
    paint: "#2c3038",
    trim: "#0c0d10",
    length: 4.92,
    width: 1.85,
    height: 1.46,
    wheelbase: 2.94,
    wheelR: 0.33,
    ground: 0.13,
    body: "sedan"
  },
  korando: {
    name: "SsangYong Korando",
    paint: "#6a7180",
    trim: "#1a1c1f",
    length: 4.41,
    width: 1.89,
    height: 1.67,
    wheelbase: 2.67,
    wheelR: 0.35,
    ground: 0.2,
    body: "suv"
  },
  golf: {
    name: "Volkswagen Golf VII",
    paint: "#8f1d22",
    trim: "#141518",
    length: 4.26,
    width: 1.79,
    height: 1.45,
    wheelbase: 2.62,
    wheelR: 0.32,
    ground: 0.13,
    body: "hatch"
  }
};

function bodySpec(car) {
  const L = car.length;
  const W = car.width * 0.5;
  const H = car.height;
  const g = car.ground;
  const kind = car.body;
  const z0 = L / 2;
  const z1 = -L / 2;
  const belt = kind === "sedan" ? 0.58 : kind === "hatch" ? 0.6 : 0.66;
  const roof = H - 0.04;
  const nose = kind === "sedan" ? 0.08 : 0.12;
  const stations = [
    { t: 0.0, w: W * 0.62, h: g + 0.42, y: g, r: 0.08 },
    { t: 0.04, w: W * 0.9, h: g + 0.55, y: g, r: 0.1 },
    { t: 0.12, w: W * 0.98, h: g + belt * 0.92, y: g, r: 0.11 },
    { t: kind === "sedan" ? 0.28 : 0.22, w: W, h: g + belt, y: g, r: 0.12 },
    { t: 0.42, w: W, h: g + belt, y: g, r: 0.12 },
    { t: 0.72, w: W * 0.99, h: g + belt * (kind === "mpv" ? 1.02 : 0.98), y: g, r: 0.12 },
    { t: kind === "sedan" ? 0.86 : 0.9, w: W * 0.96, h: g + (kind === "sedan" ? 0.52 : belt * 0.9), y: g, r: 0.1 },
    { t: 0.97, w: W * 0.78, h: g + 0.48, y: g, r: 0.08 },
    { t: 1.0, w: W * 0.55, h: g + 0.36, y: g, r: 0.06 }
  ];
  const cabinT0 = kind === "sedan" || kind === "hatch" ? 0.26 : 0.2;
  const cabinT1 = kind === "sedan" ? 0.78 : kind === "hatch" ? 0.88 : 0.9;
  const cabin = [
    { t: cabinT0, w: W * 0.72, h: roof - 0.08, y: g + belt - 0.04, r: 0.08 },
    { t: cabinT0 + 0.08, w: W * 0.78, h: roof, y: g + belt - 0.02, r: 0.1 },
    { t: 0.52, w: W * 0.8, h: roof + (kind === "mpv" || kind === "suv" ? 0.02 : 0), y: g + belt, r: 0.1 },
    { t: cabinT1 - 0.08, w: W * 0.76, h: kind === "sedan" ? roof - 0.04 : roof, y: g + belt, r: 0.09 },
    { t: cabinT1, w: W * (kind === "sedan" ? 0.62 : 0.7), h: kind === "sedan" ? g + belt + 0.12 : roof - 0.1, y: g + belt - 0.02, r: 0.07 }
  ];
  return { z0, z1, nose, stations, cabin, belt, roof, g, W, L, H };
}

function buildCar(id, car) {
  const paint = new Mesh();
  const glass = new Mesh();
  const chrome = new Mesh();
  const dark = new Mesh();
  const rubber = new Mesh();
  const lightR = new Mesh();
  const lightA = new Mesh();
  const spec = bodySpec(car);
  const bodySt = sampleStations({ z0: spec.z0, z1: spec.z1, stations: spec.stations }, 18);
  const bodyRings = bodySt.map((s) => roundedRing(0, s.y, s.z, s.w, s.h - s.y, s.r, 4));
  paint.addLoft(bodyRings);
  paint.addQuad(bodyRings[0][0], bodyRings[0][Math.floor(bodyRings[0].length / 4)], bodyRings[0][Math.floor(bodyRings[0].length / 2)], bodyRings[0][Math.floor((bodyRings[0].length * 3) / 4)]);
  const last = bodyRings[bodyRings.length - 1];
  paint.addQuad(last[0], last[Math.floor((last.length * 3) / 4)], last[Math.floor(last.length / 2)], last[Math.floor(last.length / 4)]);

  const cabSt = sampleStations(
    {
      z0: lerp(spec.z0, spec.z1, spec.cabin[0].t),
      z1: lerp(spec.z0, spec.z1, spec.cabin[spec.cabin.length - 1].t),
      stations: spec.cabin.map((s, i, arr) => Object.assign({}, s, { t: i / (arr.length - 1) }))
    },
    12
  );
  const cabRings = cabSt.map((s) => roundedRing(0, s.y, s.z, s.w, s.h - s.y, s.r, 4));
  paint.addLoft(cabRings);
  const cabLast = cabRings[cabRings.length - 1];
  paint.addQuad(cabLast[0], cabLast[Math.floor((cabLast.length * 3) / 4)], cabLast[Math.floor(cabLast.length / 2)], cabLast[Math.floor(cabLast.length / 4)]);

  const W = spec.W;
  const L = spec.L;
  const g = spec.g;
  const belt = spec.belt;
  const roof = spec.roof;

  glass.addBox(0, belt + (roof - belt) * 0.52, -L * 0.02, W * 1.28, (roof - belt) * 0.55, L * 0.28);
  glass.addBox(0, belt + (roof - belt) * 0.55, -L * 0.26, W * 1.08, (roof - belt) * 0.42, L * 0.08, 0.22, 0, 0);
  glass.addBox(0, belt + (roof - belt) * 0.5, L * 0.26, W * 1.05, (roof - belt) * 0.4, car.body === "sedan" ? L * 0.08 : L * 0.11, -0.24, 0, 0);

  const wb = car.wheelbase / 2;
  const track = W * 0.82;
  const wr = car.wheelR;
  [
    [track, wr, wb],
    [-track, wr, wb],
    [track, wr, -wb],
    [-track, wr, -wb]
  ].forEach((p) => {
    rubber.addCylinder(p[0], p[1], p[2], wr * 1.08, 0.28, 20, "x");
    chrome.addCylinder(p[0], p[1], p[2], wr * 0.58, 0.18, 16, "x");
    dark.addCylinder(p[0], p[1], p[2], wr * 0.2, 0.2, 12, "x");
  });

  dark.addBox(0, 0.03, 0, W * 1.7, 0.02, L * 0.92);
  dark.addBox(0, g * 0.55, 0, W * 1.55, g * 0.5, L * 0.72);

  chrome.addBox(0, belt * 0.92, 0, W * 1.72, 0.018, L * 0.55);
  paint.addBox(W * 0.92, belt + 0.08, -L * 0.04, 0.18, 0.12, 0.28, 0, 0.15, 0);
  paint.addBox(-W * 0.92, belt + 0.08, -L * 0.04, 0.18, 0.12, 0.28, 0, -0.15, 0);
  glass.addBox(W * 0.98, belt + 0.08, -L * 0.04, 0.02, 0.08, 0.16, 0, 0.15, 0);
  glass.addBox(-W * 0.98, belt + 0.08, -L * 0.04, 0.02, 0.08, 0.16, 0, -0.15, 0);

  if (car.body === "mpv" || car.body === "suv" || car.body === "crossover") {
    chrome.addBox(W * 0.55, roof + 0.02, 0, 0.03, 0.03, L * 0.42);
    chrome.addBox(-W * 0.55, roof + 0.02, 0, 0.03, 0.03, L * 0.42);
  }

  const noseZ = spec.z0 - 0.04;
  const tailZ = spec.z1 + 0.05;

  if (id === "verso") {
    chrome.addBox(0, 0.42, noseZ, W * 1.35, 0.04, 0.04);
    dark.addBox(0, 0.52, noseZ + 0.01, W * 1.2, 0.16, 0.03);
    lightA.addBox(W * 0.62, 0.52, noseZ + 0.02, 0.38, 0.12, 0.05);
    lightA.addBox(-W * 0.62, 0.52, noseZ + 0.02, 0.38, 0.12, 0.05);
    lightR.addBox(W * 0.72, 0.78, tailZ, 0.22, 0.52, 0.08);
    lightR.addBox(-W * 0.72, 0.78, tailZ, 0.22, 0.52, 0.08);
    chrome.addBox(0, 0.92, tailZ, W * 0.4, 0.04, 0.03);
    chrome.addBox(0, 0.4, tailZ, 0.42, 0.14, 0.04);
    paint.addBox(0, roof - 0.02, -L * 0.05, W * 0.9, 0.04, L * 0.5);
  } else if (id === "scross") {
    chrome.addBox(0, 0.48, noseZ, W * 1.5, 0.07, 0.05);
    dark.addBox(0, 0.62, noseZ + 0.01, W * 1.15, 0.18, 0.03);
    chrome.addBox(0, 0.62, noseZ + 0.02, W * 0.9, 0.015, 0.02);
    chrome.addBox(0, 0.56, noseZ + 0.02, W * 0.9, 0.015, 0.02);
    lightA.addBox(W * 0.68, 0.55, noseZ + 0.02, 0.32, 0.14, 0.06);
    lightA.addBox(-W * 0.68, 0.55, noseZ + 0.02, 0.32, 0.14, 0.06);
    dark.addBox(0, 0.22, 0, W * 1.78, 0.18, L * 0.78);
    lightR.addBox(W * 0.7, 0.74, tailZ, 0.38, 0.2, 0.08);
    lightR.addBox(-W * 0.7, 0.74, tailZ, 0.38, 0.2, 0.08);
    chrome.addBox(0, 0.7, tailZ, W * 1.15, 0.03, 0.04);
    chrome.addBox(0, 0.4, tailZ, 0.4, 0.13, 0.04);
  } else if (id === "bmw3") {
    const ky = 0.48;
    chrome.addBox(0.16, ky, noseZ, 0.28, 0.22, 0.06, 0, 0, 0.18);
    chrome.addBox(-0.16, ky, noseZ, 0.28, 0.22, 0.06, 0, 0, -0.18);
    dark.addBox(0.16, ky, noseZ + 0.02, 0.2, 0.16, 0.04, 0, 0, 0.18);
    dark.addBox(-0.16, ky, noseZ + 0.02, 0.2, 0.16, 0.04, 0, 0, -0.18);
    lightA.addBox(W * 0.7, 0.5, noseZ + 0.02, 0.38, 0.1, 0.05);
    lightA.addBox(-W * 0.7, 0.5, noseZ + 0.02, 0.38, 0.1, 0.05);
    chrome.addBox(0, 0.38, noseZ, W * 1.4, 0.03, 0.04);
    lightR.addBox(W * 0.72, 0.7, tailZ, 0.42, 0.16, 0.07);
    lightR.addBox(-W * 0.72, 0.7, tailZ, 0.42, 0.16, 0.07);
    lightR.addBox(W * 0.84, 0.62, tailZ, 0.1, 0.28, 0.05);
    lightR.addBox(-W * 0.84, 0.62, tailZ, 0.1, 0.28, 0.05);
    paint.addBox(0, 0.95, spec.z1 + 0.22, W * 1.2, 0.06, 0.18);
    chrome.addBox(W * 0.28, 0.18, spec.z1 + 0.08, 0.08, 0.05, 0.08);
    chrome.addBox(-W * 0.28, 0.18, spec.z1 + 0.08, 0.08, 0.05, 0.08);
    chrome.addBox(0, 0.4, tailZ, 0.4, 0.13, 0.04);
  } else if (id === "merc_e") {
    chrome.addBox(0, 0.5, noseZ, W * 1.15, 0.28, 0.05);
    dark.addBox(0, 0.5, noseZ + 0.02, W * 1.02, 0.22, 0.03);
    for (let i = -3; i <= 3; i++) chrome.addBox(i * 0.13, 0.5, noseZ + 0.03, 0.04, 0.18, 0.02);
    chrome.addBox(0, 0.62, noseZ + 0.03, 0.12, 0.12, 0.03);
    lightA.addBox(W * 0.72, 0.5, noseZ + 0.02, 0.34, 0.1, 0.05);
    lightA.addBox(-W * 0.72, 0.5, noseZ + 0.02, 0.34, 0.1, 0.05);
    lightR.addBox(0, 0.72, tailZ, W * 1.62, 0.1, 0.06);
    lightR.addBox(W * 0.74, 0.72, tailZ, 0.38, 0.18, 0.07);
    lightR.addBox(-W * 0.74, 0.72, tailZ, 0.38, 0.18, 0.07);
    chrome.addBox(0, 0.64, tailZ, W * 1.5, 0.02, 0.03);
    chrome.addBox(0, 0.4, tailZ, 0.42, 0.14, 0.04);
    chrome.addBox(0, belt + 0.02, 0, W * 1.74, 0.012, L * 0.62);
  } else if (id === "korando") {
    dark.addBox(0, 0.58, noseZ, W * 1.25, 0.22, 0.04);
    chrome.addBox(0, 0.48, noseZ, W * 1.4, 0.05, 0.04);
    chrome.addBox(0, 0.58, noseZ + 0.02, W * 0.7, 0.02, 0.02);
    lightA.addBox(W * 0.7, 0.58, noseZ + 0.02, 0.3, 0.16, 0.06);
    lightA.addBox(-W * 0.7, 0.58, noseZ + 0.02, 0.3, 0.16, 0.06);
    dark.addBox(0, 0.22, 0, W * 1.86, 0.22, L * 0.82);
    lightR.addBox(W * 0.7, 0.86, tailZ, 0.34, 0.26, 0.08);
    lightR.addBox(-W * 0.7, 0.86, tailZ, 0.34, 0.26, 0.08);
    dark.addBox(0, 0.55, tailZ, W * 0.5, 0.28, 0.04);
    chrome.addBox(0, 0.42, tailZ, 0.4, 0.13, 0.04);
    paint.addBox(0, roof - 0.01, -0.05, W * 0.95, 0.05, L * 0.48);
  } else if (id === "golf") {
    dark.addBox(0, 0.5, noseZ, W * 1.2, 0.2, 0.04);
    chrome.addBox(0, 0.42, noseZ, W * 1.38, 0.04, 0.04);
    for (let i = -2; i <= 2; i++) chrome.addBox(0, 0.5 + i * 0.028, noseZ + 0.02, W * 0.72, 0.012, 0.02);
    lightA.addBox(W * 0.68, 0.5, noseZ + 0.02, 0.34, 0.13, 0.05);
    lightA.addBox(-W * 0.68, 0.5, noseZ + 0.02, 0.34, 0.13, 0.05);
    lightR.addBox(W * 0.68, 0.74, tailZ, 0.48, 0.18, 0.07);
    lightR.addBox(-W * 0.68, 0.74, tailZ, 0.48, 0.18, 0.07);
    lightR.addBox(0, 0.74, tailZ, W * 1.22, 0.06, 0.04);
    chrome.addBox(0, 0.4, tailZ, 0.4, 0.13, 0.04);
    paint.addBox(0, 0.98, spec.z1 + 0.18, W * 1.15, 0.05, 0.16, 0.35, 0, 0);
  }

  lightA.addBox(W * 0.55, 0.38, noseZ + 0.01, 0.16, 0.06, 0.04);
  lightA.addBox(-W * 0.55, 0.38, noseZ + 0.01, 0.16, 0.06, 0.04);

  const rgb = hexRgb(car.paint);
  const materials = [
    mat("paint", rgb, 0.22, 0.38),
    mat("glass", [0.08, 0.12, 0.2, 0.62], 0.05, 0.08, "BLEND"),
    mat("chrome", [0.86, 0.88, 0.92, 1], 0.48, 0.22),
    mat("trim", hexRgb(car.trim).concat([1]), 0.12, 0.55),
    mat("rubber", [0.05, 0.05, 0.05, 1], 0.05, 0.85),
    Object.assign(mat("tail", [0.7, 0.05, 0.06, 1], 0.25, 0.22), { emissiveFactor: [1, 0.08, 0.05] }),
    Object.assign(mat("head", [0.95, 0.96, 0.9, 1], 0.4, 0.12), { emissiveFactor: [1, 0.96, 0.82] })
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
    doubleSided: false
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
  const primitives = packed.primitives.map((p) => {
    const acc = accessors.length;
    accessors.push({
      bufferView: 0,
      byteOffset: p.iStart * indexSize,
      componentType: use32 ? 5125 : 5123,
      count: p.iCount,
      type: "SCALAR"
    });
    return {
      attributes: { POSITION: packed.primitives.length, NORMAL: packed.primitives.length + 1 },
      indices: acc,
      material: p.material,
      mode: 4
    };
  });
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
    asset: { version: "2.0", generator: "nav-garage" },
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
  return { id, name, json, bin };
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
  console.log(id, fs.statSync(file).size, "bytes", CARS[id].name);
});
