import Constants from 'expo-constants';
import { Platform } from 'react-native';

function hostFromExpo(): string | null {
  const uri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri ||
    '';
  const match = String(uri).match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  if (match) return match[1];
  const hostMatch = String(uri).match(/:\/\/([^:/]+)/);
  if (hostMatch && hostMatch[1] !== 'exp.host') return hostMatch[1];
  return null;
}

export function defaultRelayUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_RELAY_URL;
  if (fromEnv) return fromEnv;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname || '127.0.0.1';
    return `${protocol}://${host}:8787`;
  }

  const host = hostFromExpo();
  if (host) return `ws://${host}:8787`;
  return 'ws://127.0.0.1:8787';
}

export function httpUrlFromWs(wsUrl: string): string {
  return wsUrl.replace(/^ws/i, 'http');
}

export function wsUrl(relayUrl: string): string {
  const trimmed = relayUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/v1/ws')) return trimmed;
  return `${trimmed}/v1/ws`;
}
