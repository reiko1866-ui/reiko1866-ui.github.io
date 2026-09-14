'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALPHABET,
  generatePairCode,
  normalizePairCode,
  isValidPairCode,
} = require('./pairCode.js');

test('generates 6 unambiguous characters', () => {
  let i = 0;
  const fakeRandom = () => {
    const value = (i % ALPHABET.length) / ALPHABET.length;
    i += 1;
    return value;
  };
  const code = generatePairCode(fakeRandom);
  assert.equal(code.length, 6);
  assert.equal(isValidPairCode(code), true);
});

test('normalizes spacing and case', () => {
  assert.equal(normalizePairCode('ab cd-ef'), 'ABCDEF');
  assert.equal(isValidPairCode('ab cd-ef'), true);
  assert.equal(isValidPairCode('OIL123'), false);
});
