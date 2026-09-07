import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { defaultRelayUrl } from './relayUrl';
import type { Session } from './types';

function profilePrefix(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const profil = new URLSearchParams(window.location.search).get('profil');
    if (profil) return `ketten:${profil}:`;
  }
  return 'ketten:';
}

function randomId(): string {
  const bytes = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `ktt_${bytes}`;
}

export async function loadSession(): Promise<Session> {
  const prefix = profilePrefix();
  const entries = await AsyncStorage.multiGet([
    `${prefix}deviceId`,
    `${prefix}name`,
    `${prefix}pairCode`,
    `${prefix}sharing`,
    `${prefix}relayUrl`,
    `${prefix}demo`,
    `${prefix}testOffset`,
  ]);
  const map = Object.fromEntries(entries);
  return {
    deviceId: map[`${prefix}deviceId`] || randomId(),
    name: map[`${prefix}name`] || '',
    pairCode: map[`${prefix}pairCode`] || null,
    sharing: map[`${prefix}sharing`] !== '0',
    relayUrl: map[`${prefix}relayUrl`] || defaultRelayUrl(),
    demo: map[`${prefix}demo`] === '1',
    testOffset:
      map[`${prefix}testOffset`] === '1' ||
      (map[`${prefix}testOffset`] == null && Platform.OS === 'web'),
  };
}

export async function saveSession(session: Session): Promise<void> {
  const prefix = profilePrefix();
  await AsyncStorage.multiSet([
    [`${prefix}deviceId`, session.deviceId],
    [`${prefix}name`, session.name],
    [`${prefix}pairCode`, session.pairCode || ''],
    [`${prefix}sharing`, session.sharing ? '1' : '0'],
    [`${prefix}relayUrl`, session.relayUrl],
    [`${prefix}demo`, session.demo ? '1' : '0'],
    [`${prefix}testOffset`, session.testOffset ? '1' : '0'],
  ]);
}

export async function clearPair(session: Session): Promise<Session> {
  const next = { ...session, pairCode: null, demo: false };
  await saveSession(next);
  return next;
}
