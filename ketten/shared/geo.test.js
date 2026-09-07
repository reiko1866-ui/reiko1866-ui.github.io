'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  haversineMeters,
  offsetCoordinate,
  formatDistanceHu,
  formatRelativeTimeHu,
  initials,
} = require('./geo.js');

test('Budapest–Debrecen roughly 195 km', () => {
  const bp = { lat: 47.4979, lng: 19.0402 };
  const db = { lat: 47.5316, lng: 21.6273 };
  const meters = haversineMeters(bp, db);
  assert.ok(meters > 190_000 && meters < 205_000, `got ${meters}`);
});

test('offset 1000 m north increases latitude', () => {
  const origin = { lat: 47.5, lng: 19.05 };
  const north = offsetCoordinate(origin, 1000, 0);
  assert.ok(north.lat > origin.lat);
  const dist = haversineMeters(origin, north);
  assert.ok(Math.abs(dist - 1000) < 3, `got ${dist}`);
});

test('formats Hungarian distances', () => {
  assert.equal(formatDistanceHu(42), '42 m');
  assert.equal(formatDistanceHu(1530), '1,5 km');
  assert.equal(formatDistanceHu(12500), '13 km');
});

test('formats relative time in Hungarian', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatRelativeTimeHu(now - 2000, now), 'épp most');
  assert.equal(formatRelativeTimeHu(now - 20_000, now), '20 mp');
  assert.equal(formatRelativeTimeHu(now - 5 * 60_000, now), '5 perce');
});

test('initials from names', () => {
  assert.equal(initials('Anna'), 'AN');
  assert.equal(initials('Kiss Péter'), 'KP');
  assert.equal(initials(''), '?');
});
