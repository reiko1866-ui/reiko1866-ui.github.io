'use strict';

const { generatePairCode, normalizePairCode, isValidPairCode } = require('../shared/pairCode.js');

const COLORS = ['#E85D75', '#5B9CFF'];
const MAX_MEMBERS = 2;

function nowMs() {
  return Date.now();
}

function publicMember(member, { includeOnline = true } = {}) {
  if (!member) return null;
  return {
    deviceId: member.deviceId,
    name: member.name,
    color: member.color,
    sharing: Boolean(member.sharing),
    online: includeOnline ? Boolean(member.socketId) : Boolean(member.online),
    location: member.location
      ? {
          lat: member.location.lat,
          lng: member.location.lng,
          heading: member.location.heading ?? null,
          speed: member.location.speed ?? null,
          accuracy: member.location.accuracy ?? null,
          updatedAt: member.location.updatedAt,
        }
      : null,
  };
}

function createStore({ random = Math.random, clock = nowMs } = {}) {
  /** @type {Map<string, any>} */
  const pairs = new Map();

  function uniqueCode() {
    for (let i = 0; i < 40; i += 1) {
      const code = generatePairCode(random);
      if (!pairs.has(code)) return code;
    }
    throw new Error('Nem sikerült egyedi párt kódot kiosztani.');
  }

  function getPair(code) {
    const normalized = normalizePairCode(code);
    return pairs.get(normalized) || null;
  }

  function ensurePair(code) {
    const pair = getPair(code);
    if (!pair) {
      const err = new Error('Nincs ilyen párkód.');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return pair;
  }

  function memberList(pair) {
    return [...pair.members.values()].map((member) => publicMember(member));
  }

  function partnerOf(pair, deviceId) {
    for (const member of pair.members.values()) {
      if (member.deviceId !== deviceId) return member;
    }
    return null;
  }

  function createPair({ deviceId, name }) {
    if (!deviceId || !String(name || '').trim()) {
      const err = new Error('Név és eszközazonosító kell.');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    const code = uniqueCode();
    const member = {
      deviceId: String(deviceId),
      name: String(name).trim().slice(0, 32),
      color: COLORS[0],
      sharing: true,
      socketId: null,
      location: null,
    };
    const pair = {
      code,
      createdAt: clock(),
      members: new Map([[member.deviceId, member]]),
    };
    pairs.set(code, pair);
    return {
      pairCode: code,
      you: publicMember(member),
      partner: null,
      members: memberList(pair),
    };
  }

  function joinPair({ code, deviceId, name }) {
    if (!isValidPairCode(code)) {
      const err = new Error('Érvénytelen párkód.');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    if (!deviceId || !String(name || '').trim()) {
      const err = new Error('Név és eszközazonosító kell.');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    const pair = ensurePair(code);
    const existing = pair.members.get(deviceId);
    if (existing) {
      existing.name = String(name).trim().slice(0, 32);
      return {
        pairCode: pair.code,
        you: publicMember(existing),
        partner: publicMember(partnerOf(pair, deviceId)),
        members: memberList(pair),
      };
    }
    if (pair.members.size >= MAX_MEMBERS) {
      const err = new Error('Ez a pár már tele van.');
      err.code = 'FULL';
      throw err;
    }
    const member = {
      deviceId: String(deviceId),
      name: String(name).trim().slice(0, 32),
      color: COLORS[pair.members.size] || COLORS[1],
      sharing: true,
      socketId: null,
      location: null,
    };
    pair.members.set(member.deviceId, member);
    return {
      pairCode: pair.code,
      you: publicMember(member),
      partner: publicMember(partnerOf(pair, deviceId)),
      members: memberList(pair),
    };
  }

  function leavePair({ code, deviceId }) {
    const pair = getPair(code);
    if (!pair) return { ok: true, empty: true };
    pair.members.delete(deviceId);
    if (pair.members.size === 0) pairs.delete(pair.code);
    return { ok: true, empty: pair.members.size === 0, members: pair.members.size ? memberList(pair) : [] };
  }

  function setSocket({ code, deviceId, socketId }) {
    const pair = ensurePair(code);
    const member = pair.members.get(deviceId);
    if (!member) {
      const err = new Error('Nem vagy tagja ennek a párnak.');
      err.code = 'FORBIDDEN';
      throw err;
    }
    member.socketId = socketId || null;
    return {
      pairCode: pair.code,
      you: publicMember(member),
      partner: publicMember(partnerOf(pair, deviceId)),
      members: memberList(pair),
    };
  }

  function setSharing({ code, deviceId, sharing }) {
    const pair = ensurePair(code);
    const member = pair.members.get(deviceId);
    if (!member) {
      const err = new Error('Nem vagy tagja ennek a párnak.');
      err.code = 'FORBIDDEN';
      throw err;
    }
    member.sharing = Boolean(sharing);
    return {
      you: publicMember(member),
      partner: publicMember(partnerOf(pair, deviceId)),
      members: memberList(pair),
    };
  }

  function setLocation({ code, deviceId, location }) {
    const pair = ensurePair(code);
    const member = pair.members.get(deviceId);
    if (!member) {
      const err = new Error('Nem vagy tagja ennek a párnak.');
      err.code = 'FORBIDDEN';
      throw err;
    }
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      const err = new Error('Érvénytelen helyzet.');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    member.location = {
      lat: Number(location.lat),
      lng: Number(location.lng),
      heading: Number.isFinite(location.heading) ? Number(location.heading) : null,
      speed: Number.isFinite(location.speed) ? Number(location.speed) : null,
      accuracy: Number.isFinite(location.accuracy) ? Number(location.accuracy) : null,
      updatedAt: clock(),
    };
    if (location.sharing !== undefined) member.sharing = Boolean(location.sharing);
    return {
      you: publicMember(member),
      partner: publicMember(partnerOf(pair, deviceId)),
      members: memberList(pair),
    };
  }

  function getState({ code, deviceId }) {
    const pair = ensurePair(code);
    if (deviceId && !pair.members.has(deviceId)) {
      const err = new Error('Nem vagy tagja ennek a párnak.');
      err.code = 'FORBIDDEN';
      throw err;
    }
    return {
      pairCode: pair.code,
      you: deviceId ? publicMember(pair.members.get(deviceId)) : null,
      partner: deviceId ? publicMember(partnerOf(pair, deviceId)) : null,
      members: memberList(pair),
    };
  }

  function serialize() {
    return [...pairs.values()].map((pair) => ({
      code: pair.code,
      createdAt: pair.createdAt,
      members: [...pair.members.values()].map((member) => ({
        deviceId: member.deviceId,
        name: member.name,
        color: member.color,
        sharing: member.sharing,
        location: member.location,
      })),
    }));
  }

  function restore(rows) {
    pairs.clear();
    for (const row of rows || []) {
      const members = new Map();
      for (const member of row.members || []) {
        members.set(member.deviceId, { ...member, socketId: null });
      }
      pairs.set(row.code, {
        code: row.code,
        createdAt: row.createdAt || clock(),
        members,
      });
    }
  }

  return {
    createPair,
    joinPair,
    leavePair,
    setSocket,
    setSharing,
    setLocation,
    getState,
    serialize,
    restore,
  };
}

module.exports = { createStore, publicMember, COLORS, MAX_MEMBERS };
