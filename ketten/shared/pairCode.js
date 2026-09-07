'use strict';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePairCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return code;
}

function normalizePairCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isValidPairCode(input) {
  const code = normalizePairCode(input);
  return code.length === 6 && [...code].every((ch) => ALPHABET.includes(ch));
}

module.exports = {
  ALPHABET,
  generatePairCode,
  normalizePairCode,
  isValidPairCode,
};
