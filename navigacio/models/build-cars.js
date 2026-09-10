#!/usr/bin/env node
"use strict";

/**
 * Low-poly chibi / toy-car GLB fleet.
 * Y-up, origin on the ground at the wheelbase center.
 * +Z is the nose (headlights), −Z is the tail.
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
    seg = seg || 12;
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
  addEllipsoid(cx, cy, cz, rx, ry, rz, slices, stacks) {
    slices = slices || 10;
    stacks = stacks || 7;
    const grid = [];
    for (let i = 0; i <= stacks; i++) {
      const phi = (i / stacks) * Math.PI;
      const row = [];
      for (let j = 0; j <= slices; j++) {
        const th = (j / slices) * Math.PI * 2;
        row.push([
          cx + rx * Math.sin(phi) * Math.cos(th),
          cy + ry * Math.cos(phi),
          cz + rz * Math.sin(phi) * Math.sin(th)
        ]);
      }
      grid.push(row);
    }
    for (let i = 0; i < stacks; i++) {
      for (let j = 0; j < slices; j++) {
        this.addQuad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
      }
    }
  }
}

const CARS = {
  verso: {
    name: "Mini Verso",
    paint: "#d4d7de",
    trim: "#2a2e33",
    length: 2.18,
    width: 1.52,
    height: 1.68,
    wheelbase: 1.22,
    wheelR: 0.44,
    bodyH: 0.8,
    cabinH: 0.82,
    cabinShift: 0.04,
    kind: "mpv"
  },
  scross: {
    name: "Mini SX4 S-Cross",
    paint: "#f3efe6",
    trim: "#1b1d20",
    length: 2.12,
    width: 1.5,
    height: 1.6,
    wheelbase: 1.2,
    wheelR: 0.43,
    bodyH: 0.76,
    cabinH: 0.74,
    cabinShift: 0.02,
    kind: "crossover"
  },
  bmw3: {
    name: "Mini 3er / M3",
    paint: "#b7c0cb",
    trim: "#111318",
    length: 2.28,
    width: 1.48,
    height: 1.42,
    wheelbase: 1.28,
    wheelR: 0.4,
    bodyH: 0.64,
    cabinH: 0.62,
    cabinShift: -0.02,
    kind: "sedan"
  },
  merc_e: {
    name: "Mini E-Class",
    paint: "#1c1f26",
    trim: "#0c0d10",
    length: 2.32,
    width: 1.5,
    height: 1.44,
    wheelbase: 1.32,
    wheelR: 0.4,
    bodyH: 0.62,
    cabinH: 0.6,
    cabinShift: -0.04,
    kind: "sedan"
  },
  korando: {
    name: "Mini Korando",
    paint: "#6a7180",
    trim: "#1a1c1f",
    length: 2.16,
    width: 1.56,
    height: 1.72,
    wheelbase: 1.18,
    wheelR: 0.46,
    bodyH: 0.84,
    cabinH: 0.86,
    cabinShift: 0.0,
    kind: "suv"
  },
  golf: {
    name: "Mini Golf",
    paint: "#b91c1c",
    trim: "#141518",
    length: 2.08,
    width: 1.46,
    height: 1.48,
    wheelbase: 1.16,
    wheelR: 0.41,
    bodyH: 0.68,
    cabinH: 0.68,
    cabinShift: 0.06,
    kind: "hatch"
  }
};

function buildCar(id, car) {
  const paint = new Mesh();
  const glass = new Mesh();
  const chrome = new Mesh();
  const dark = new Mesh();
  const rubber = new Mesh();
  const lightR = new Mesh();
  const lightA = new Mesh();

  const L = car.length;
  const W = car.width * 0.5;
  const wr = car.wheelR;
  const wb = car.wheelbase / 2;
  const track = W * 0.78;
  const bodyY = wr * 0.92;
  const cabinY = bodyY + car.bodyH * 0.42 + car.cabinH * 0.28;
  const noseZ = L * 0.46;
  const tailZ = -L * 0.46;

  paint.addEllipsoid(0, bodyY, 0.02, W * 0.98, car.bodyH * 0.52, L * 0.4, 10, 7);
  paint.addBox(0, bodyY * 0.7, 0, W * 1.72, bodyY * 0.55, L * 0.72);
  paint.addEllipsoid(0, cabinY, -L * car.cabinShift, W * 0.7, car.cabinH * 0.48, L * 0.26, 8, 6);
  glass.addEllipsoid(0, cabinY + 0.02, -L * car.cabinShift + 0.02, W * 0.62, car.cabinH * 0.4, L * 0.22, 8, 6);
  glass.addBox(0, cabinY + car.cabinH * 0.08, noseZ * 0.22, W * 1.05, car.cabinH * 0.42, L * 0.1, 0.38, 0, 0);
  glass.addBox(0, cabinY + car.cabinH * 0.02, tailZ * 0.28, W * 1.0, car.cabinH * 0.36, L * 0.09, -0.32, 0, 0);

  [
    [track, wr, wb],
    [-track, wr, wb],
    [track, wr, -wb],
    [-track, wr, -wb]
  ].forEach((p) => {
    rubber.addCylinder(p[0], p[1], p[2], wr, 0.42, 12, "x");
    chrome.addCylinder(p[0], p[1], p[2], wr * 0.58, 0.28, 10, "x");
    dark.addCylinder(p[0], p[1], p[2], wr * 0.22, 0.3, 8, "x");
    paint.addEllipsoid(p[0] * 0.72, wr * 1.05, p[2], 0.16, wr * 0.42, wr * 0.55, 7, 5);
  });

  dark.addBox(0, 0.04, 0, W * 1.55, 0.08, L * 0.7);
  chrome.addBox(0, bodyY + car.bodyH * 0.18, 0, W * 1.78, 0.03, L * 0.42);

  if (id === "verso") {
    chrome.addBox(0, bodyY + 0.08, noseZ, W * 1.35, 0.08, 0.08);
    dark.addBox(0, bodyY + 0.18, noseZ + 0.02, W * 1.1, 0.22, 0.06);
    lightA.addBox(W * 0.62, bodyY + 0.16, noseZ + 0.04, 0.42, 0.2, 0.1);
    lightA.addBox(-W * 0.62, bodyY + 0.16, noseZ + 0.04, 0.42, 0.2, 0.1);
    lightR.addBox(W * 0.7, bodyY + 0.28, tailZ, 0.28, 0.48, 0.12);
    lightR.addBox(-W * 0.7, bodyY + 0.28, tailZ, 0.28, 0.48, 0.12);
    chrome.addBox(0, cabinY + car.cabinH * 0.42, -0.02, W * 0.55, 0.04, L * 0.32);
    paint.addBox(0, cabinY + car.cabinH * 0.38, -0.04, W * 1.05, 0.08, L * 0.38);
  } else if (id === "scross") {
    chrome.addBox(0, bodyY + 0.1, noseZ, W * 1.45, 0.1, 0.1);
    dark.addBox(0, bodyY + 0.2, noseZ + 0.02, W * 1.12, 0.2, 0.06);
    chrome.addBox(0, bodyY + 0.16, noseZ + 0.04, W * 0.85, 0.03, 0.04);
    chrome.addBox(0, bodyY + 0.24, noseZ + 0.04, W * 0.85, 0.03, 0.04);
    lightA.addBox(W * 0.66, bodyY + 0.18, noseZ + 0.04, 0.36, 0.22, 0.1);
    lightA.addBox(-W * 0.66, bodyY + 0.18, noseZ + 0.04, 0.36, 0.22, 0.1);
    dark.addBox(0, wr * 0.55, 0, W * 1.82, wr * 0.5, L * 0.78);
    lightR.addBox(W * 0.68, bodyY + 0.22, tailZ, 0.42, 0.24, 0.12);
    lightR.addBox(-W * 0.68, bodyY + 0.22, tailZ, 0.42, 0.24, 0.12);
    chrome.addBox(0, bodyY + 0.22, tailZ, W * 1.2, 0.05, 0.06);
  } else if (id === "bmw3") {
    chrome.addBox(0.18, bodyY + 0.08, noseZ, 0.32, 0.28, 0.1, 0, 0, 0.2);
    chrome.addBox(-0.18, bodyY + 0.08, noseZ, 0.32, 0.28, 0.1, 0, 0, -0.2);
    dark.addBox(0.18, bodyY + 0.08, noseZ + 0.04, 0.22, 0.2, 0.06, 0, 0, 0.2);
    dark.addBox(-0.18, bodyY + 0.08, noseZ + 0.04, 0.22, 0.2, 0.06, 0, 0, -0.2);
    lightA.addBox(W * 0.7, bodyY + 0.12, noseZ + 0.04, 0.4, 0.16, 0.08);
    lightA.addBox(-W * 0.7, bodyY + 0.12, noseZ + 0.04, 0.4, 0.16, 0.08);
    lightR.addBox(W * 0.7, bodyY + 0.16, tailZ, 0.44, 0.18, 0.1);
    lightR.addBox(-W * 0.7, bodyY + 0.16, tailZ, 0.44, 0.18, 0.1);
    lightR.addBox(W * 0.82, bodyY + 0.08, tailZ, 0.12, 0.32, 0.08);
    lightR.addBox(-W * 0.82, bodyY + 0.08, tailZ, 0.12, 0.32, 0.08);
    paint.addBox(0, cabinY + 0.18, tailZ + 0.12, W * 0.7, 0.08, 0.22);
    dark.addBox(W * 0.55, wr * 0.45, noseZ * 0.55, 0.22, 0.16, 0.28);
    dark.addBox(-W * 0.55, wr * 0.45, noseZ * 0.55, 0.22, 0.16, 0.28);
  } else if (id === "merc_e") {
    chrome.addBox(0, bodyY + 0.12, noseZ, W * 1.2, 0.32, 0.08);
    dark.addBox(0, bodyY + 0.12, noseZ + 0.03, W * 1.05, 0.24, 0.05);
    for (let i = -3; i <= 3; i++) chrome.addBox(i * 0.12, bodyY + 0.12, noseZ + 0.05, 0.05, 0.2, 0.03);
    chrome.addCylinder(0, bodyY + 0.22, noseZ + 0.06, 0.08, 0.04, 10, "z");
    lightA.addBox(W * 0.72, bodyY + 0.12, noseZ + 0.04, 0.36, 0.14, 0.08);
    lightA.addBox(-W * 0.72, bodyY + 0.12, noseZ + 0.04, 0.36, 0.14, 0.08);
    lightR.addBox(0, bodyY + 0.2, tailZ, W * 1.7, 0.12, 0.08);
    lightR.addBox(W * 0.74, bodyY + 0.2, tailZ, 0.36, 0.2, 0.1);
    lightR.addBox(-W * 0.74, bodyY + 0.2, tailZ, 0.36, 0.2, 0.1);
    chrome.addBox(0, bodyY + car.bodyH * 0.22, 0, W * 1.82, 0.02, L * 0.5);
  } else if (id === "korando") {
    dark.addBox(0, bodyY + 0.2, noseZ, W * 1.22, 0.28, 0.08);
    chrome.addBox(0, bodyY + 0.08, noseZ, W * 1.4, 0.08, 0.08);
    lightA.addBox(W * 0.68, bodyY + 0.22, noseZ + 0.04, 0.34, 0.24, 0.1);
    lightA.addBox(-W * 0.68, bodyY + 0.22, noseZ + 0.04, 0.34, 0.24, 0.1);
    dark.addBox(0, wr * 0.55, 0, W * 1.88, wr * 0.55, L * 0.8);
    lightR.addBox(W * 0.7, bodyY + 0.32, tailZ, 0.36, 0.32, 0.12);
    lightR.addBox(-W * 0.7, bodyY + 0.32, tailZ, 0.36, 0.32, 0.12);
    chrome.addBox(W * 0.5, cabinY + car.cabinH * 0.42, 0, 0.05, 0.05, L * 0.36);
    chrome.addBox(-W * 0.5, cabinY + car.cabinH * 0.42, 0, 0.05, 0.05, L * 0.36);
    paint.addBox(0, cabinY + car.cabinH * 0.4, 0, W * 1.1, 0.1, L * 0.4);
  } else if (id === "golf") {
    dark.addBox(0, bodyY + 0.14, noseZ, W * 1.18, 0.24, 0.07);
    chrome.addBox(0, bodyY + 0.04, noseZ, W * 1.35, 0.07, 0.08);
    for (let i = -2; i <= 2; i++) chrome.addBox(0, bodyY + 0.14 + i * 0.04, noseZ + 0.04, W * 0.7, 0.02, 0.03);
    lightA.addBox(W * 0.66, bodyY + 0.14, noseZ + 0.04, 0.38, 0.2, 0.1);
    lightA.addBox(-W * 0.66, bodyY + 0.14, noseZ + 0.04, 0.38, 0.2, 0.1);
    lightR.addBox(W * 0.66, bodyY + 0.22, tailZ, 0.5, 0.22, 0.1);
    lightR.addBox(-W * 0.66, bodyY + 0.22, tailZ, 0.5, 0.22, 0.1);
    lightR.addBox(0, bodyY + 0.22, tailZ, W * 1.25, 0.08, 0.06);
    paint.addBox(0, cabinY + 0.12, tailZ + 0.16, W * 1.05, 0.1, 0.22, 0.4, 0, 0);
  }

  lightA.addBox(W * 0.52, wr * 0.7, noseZ + 0.02, 0.16, 0.1, 0.06);
  lightA.addBox(-W * 0.52, wr * 0.7, noseZ + 0.02, 0.16, 0.1, 0.06);

  const rgb = hexRgb(car.paint);
  const materials = [
    mat("paint", rgb, 0.18, 0.42),
    mat("glass", [0.12, 0.2, 0.32, 0.72], 0.05, 0.1, "BLEND"),
    mat("chrome", [0.86, 0.88, 0.92, 1], 0.55, 0.22),
    mat("trim", hexRgb(car.trim).concat([1]), 0.1, 0.6),
    mat("rubber", [0.06, 0.06, 0.06, 1], 0.04, 0.88),
    Object.assign(mat("tail", [0.78, 0.06, 0.07, 1], 0.2, 0.25), { emissiveFactor: [1, 0.1, 0.06] }),
    Object.assign(mat("head", [0.96, 0.97, 0.9, 1], 0.35, 0.14), { emissiveFactor: [1, 0.96, 0.8] })
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
    asset: { version: "2.0", generator: "nav-chibi" },
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
