'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('./rooms.js');

test('create pair then partner can join', () => {
  const store = createStore({ random: () => 0 });
  const created = store.createPair({ deviceId: 'a', name: 'Anna' });
  assert.equal(created.pairCode.length, 6);
  assert.equal(created.you.name, 'Anna');
  assert.equal(created.partner, null);

  const joined = store.joinPair({
    code: created.pairCode,
    deviceId: 'b',
    name: 'Béla',
  });
  assert.equal(joined.partner.name, 'Anna');
  assert.equal(joined.you.name, 'Béla');
  assert.equal(joined.members.length, 2);
});

test('third person cannot join a full pair', () => {
  const store = createStore({ random: () => 0 });
  const created = store.createPair({ deviceId: 'a', name: 'Anna' });
  store.joinPair({ code: created.pairCode, deviceId: 'b', name: 'Béla' });
  assert.throws(
    () => store.joinPair({ code: created.pairCode, deviceId: 'c', name: 'Cili' }),
    /tele van/,
  );
});

test('same device can rejoin and keeps membership', () => {
  const store = createStore({ random: () => 0 });
  const created = store.createPair({ deviceId: 'a', name: 'Anna' });
  store.joinPair({ code: created.pairCode, deviceId: 'b', name: 'Béla' });
  const again = store.joinPair({
    code: created.pairCode,
    deviceId: 'a',
    name: 'Anikó',
  });
  assert.equal(again.you.name, 'Anikó');
  assert.equal(again.members.length, 2);
});

test('location is stored and visible to partner', () => {
  const store = createStore({ random: () => 0, clock: () => 42 });
  const created = store.createPair({ deviceId: 'a', name: 'Anna' });
  store.joinPair({ code: created.pairCode, deviceId: 'b', name: 'Béla' });
  store.setLocation({
    code: created.pairCode,
    deviceId: 'a',
    location: { lat: 47.5, lng: 19.05, heading: 90, accuracy: 8 },
  });
  const state = store.getState({ code: created.pairCode, deviceId: 'b' });
  assert.equal(state.partner.location.lat, 47.5);
  assert.equal(state.partner.location.updatedAt, 42);
  assert.equal(state.partner.sharing, true);
});

test('unknown pair code fails', () => {
  const store = createStore();
  assert.throws(() => store.joinPair({ code: 'ABCDEF', deviceId: 'a', name: 'A' }), /Nincs ilyen/);
});

test('serialize and restore drops live sockets', () => {
  const store = createStore({ random: () => 0 });
  const created = store.createPair({ deviceId: 'a', name: 'Anna' });
  store.setSocket({ code: created.pairCode, deviceId: 'a', socketId: 'sock-1' });
  const snapshot = store.serialize();
  const restored = createStore();
  restored.restore(snapshot);
  const state = restored.getState({ code: created.pairCode, deviceId: 'a' });
  assert.equal(state.you.online, false);
  assert.equal(state.you.name, 'Anna');
});
