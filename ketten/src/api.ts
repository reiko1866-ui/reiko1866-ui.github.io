import { httpUrlFromWs } from './relayUrl';
import type { PairState } from './types';

async function request<T>(
  relayUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${httpUrlFromWs(relayUrl)}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Hiba (${response.status})`);
  }
  return body as T;
}

export function createPair(relayUrl: string, deviceId: string, name: string) {
  return request<PairState>(relayUrl, '/v1/pairs', {
    method: 'POST',
    body: JSON.stringify({ deviceId, name }),
  });
}

export function joinPair(
  relayUrl: string,
  deviceId: string,
  name: string,
  code: string,
) {
  return request<PairState>(relayUrl, '/v1/pairs/join', {
    method: 'POST',
    body: JSON.stringify({ deviceId, name, code }),
  });
}

export function leavePair(relayUrl: string, deviceId: string, code: string) {
  return request(relayUrl, '/v1/pairs/leave', {
    method: 'POST',
    body: JSON.stringify({ deviceId, code }),
  });
}

export function postLocation(
  relayUrl: string,
  payload: {
    pairCode: string;
    deviceId: string;
    lat: number;
    lng: number;
    heading?: number | null;
    speed?: number | null;
    accuracy?: number | null;
    sharing?: boolean;
  },
) {
  return request(relayUrl, '/v1/location', {
    method: 'POST',
    body: JSON.stringify({
      pairCode: payload.pairCode,
      deviceId: payload.deviceId,
      location: payload,
    }),
  });
}

export function postSharing(
  relayUrl: string,
  pairCode: string,
  deviceId: string,
  sharing: boolean,
) {
  return request(relayUrl, '/v1/sharing', {
    method: 'POST',
    body: JSON.stringify({ pairCode, deviceId, sharing }),
  });
}
