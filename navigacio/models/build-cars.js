#!/usr/bin/env node
"use strict";

/**
 * Pack Kenney Car Kit (CC0) GLBs for the dash map.
 * Y-up, origin on the ground, +Z is the nose.
 * https://kenney.nl/assets/car-kit
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crc32Table = (function () {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crc32Table[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodePng(buf) {
  if (buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") throw new Error("nem PNG");
  let off = 8;
  let w = 0;
  let h = 0;
  const idats = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const typ = buf.toString("ascii", off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (typ === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error("csak 8-bit RGBA PNG");
    } else if (typ === "IDAT") idats.push(data);
    else if (typ === "IEND") break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = w * 4;
  const rgba = Buffer.alloc(w * h * 4);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[src++];
    const row = raw.slice(src, src + stride);
    src += stride;
    const out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? out[i - 4] : 0;
      const up = prev[i];
      const ul = i >= 4 ? prev[i - 4] : 0;
      let v = row[i];
      if (filter === 1) v = (v + left) & 255;
      else if (filter === 2) v = (v + up) & 255;
      else if (filter === 3) v = (v + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - ul;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - ul);
        v = (v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 255;
      }
      out[i] = v;
    }
    out.copy(rgba, y * stride);
    prev = out;
  }
  return { w, h, rgba };
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  function chunk(typ, data) {
    const body = Buffer.concat([Buffer.from(typ), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function hexRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function recolor(png, paintHex) {
  const { w, h, rgba } = decodePng(png);
  const [pr, pg, pb] = hexRgb(paintHex);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    if (g > 145 && g > r + 18 && g >= b - 8) {
      const k = Math.max(0.72, Math.min(1.12, g / 186));
      rgba[i] = Math.max(0, Math.min(255, Math.round(pr * k)));
      rgba[i + 1] = Math.max(0, Math.min(255, Math.round(pg * k)));
      rgba[i + 2] = Math.max(0, Math.min(255, Math.round(pb * k)));
    }
  }
  return encodePng(w, h, rgba);
}

function readGlb(file) {
  const data = fs.readFileSync(file);
  const jsonLen = data.readUInt32LE(12);
  const json = JSON.parse(data.slice(20, 20 + jsonLen).toString("utf8").replace(/\0+$/g, "").trim());
  const binOff = 20 + jsonLen;
  const binLen = data.readUInt32LE(binOff);
  const bin = Buffer.from(data.slice(binOff + 8, binOff + 8 + binLen));
  return { json, bin };
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

function embedTexture(json, bin, png) {
  const pad = (4 - (bin.length % 4)) % 4;
  const start = bin.length + pad;
  const next = Buffer.concat([bin, Buffer.alloc(pad), png]);
  json.bufferViews = json.bufferViews || [];
  json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: png.length });
  json.images = [{ mimeType: "image/png", bufferView: json.bufferViews.length - 1, name: "colormap" }];
  json.asset = json.asset || { version: "2.0" };
  json.asset.generator = "nav-kenney";
  return next;
}

const FLEET = {
  verso: { src: "van.glb", paint: "#d8dbe3", name: "Mini Verso" },
  scross: { src: "suv.glb", paint: "#f4f0e8", name: "Mini SX4 S-Cross" },
  bmw3: { src: "sedan-sports.glb", paint: "#8b95a3", name: "Mini 3er / M3" },
  merc_e: { src: "sedan.glb", paint: "#1a1d24", name: "Mini E-Class" },
  korando: { src: "suv-luxury.glb", paint: "#5c6470", name: "Mini Korando" },
  golf: { src: "hatchback-sports.glb", paint: "#b4231a", name: "Mini Golf" }
};

const root = __dirname;
const kenney = path.join(root, "kenney");
const baseMap = fs.readFileSync(path.join(kenney, "colormap.png"));

Object.keys(FLEET).forEach((id) => {
  const spec = FLEET[id];
  const packed = readGlb(path.join(kenney, spec.src));
  packed.json.scenes[0].name = spec.name;
  const png = recolor(baseMap, spec.paint);
  packed.bin = embedTexture(packed.json, packed.bin, png);
  const out = path.join(root, id + ".glb");
  writeGlb(out, packed.json, packed.bin);
  console.log(id, fs.statSync(out).size, "bytes", spec.name, "from", spec.src);
});
