import { useCallback, useEffect, useRef, useState } from 'react';
import { wsUrl } from './relayUrl';
import type { Member, PairState } from './types';

type Status = 'offline' | 'connecting' | 'online';

export function useRelay(options: {
  enabled: boolean;
  relayUrl: string;
  pairCode: string | null;
  deviceId: string;
  name: string;
}) {
  const { enabled, relayUrl, pairCode, deviceId, name } = options;
  const [status, setStatus] = useState<Status>('offline');
  const [partner, setPartner] = useState<Member | null>(null);
  const [you, setYou] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(1000);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyState = useCallback((state: PairState) => {
    setYou(state.you);
    setPartner(state.partner);
  }, []);

  const disconnect = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current);
    pingRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    if (!enabled || !pairCode) {
      disconnect();
      setStatus('offline');
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');
      setError(null);
      const ws = new WebSocket(wsUrl(relayUrl));
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 1000;
        setStatus('online');
        ws.send(
          JSON.stringify({
            type: 'hello',
            pairCode,
            deviceId,
            name,
          }),
        );
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === 'state') {
            applyState(msg);
          } else if (msg.type === 'error') {
            setError(msg.message);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = null;
        if (cancelled) return;
        setStatus('offline');
        retryTimer = setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, 15000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      disconnect();
    };
  }, [enabled, relayUrl, pairCode, deviceId, name, applyState, disconnect]);

  return { status, partner, you, error, send, setPartner, setYou };
}
