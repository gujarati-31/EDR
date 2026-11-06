import { useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketMessage {
  event: string;
  data: any;
  timestamp: string;
}

export function useWebSocket(onEvent?: (event: string, data: any) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) return;
    const delay = Math.min(2000 * Math.pow(1.8, Math.min(reconnectAttemptRef.current, 5)), 15000);
    console.log(`[WS] Disconnected. Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttemptRef.current + 1})...`);
    reconnectAttemptRef.current++;
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connect();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    try {
      if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname || 'localhost';
      // In development (port 5173), connect directly to backend port 3000
      const wsPort = window.location.port === '5173' ? '3000' : window.location.port;
      const portPart = wsPort ? `:${wsPort}` : '';
      const wsUrl = `${protocol}//${host}${portPart}/ws?type=dashboard`;
      
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptRef.current = 0;
        console.log('[WS] Connected to EDR Command Bus');
      };

      ws.onmessage = (event) => {
        try {
          const parsed: WebSocketMessage = JSON.parse(event.data);
          if (onEventRef.current && parsed.event) {
            onEventRef.current(parsed.event, parsed.data);
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
        ws.close();
      };
    } catch (err) {
      console.error('[WS] Connection init error:', err);
      scheduleReconnect();
    }
  }, [scheduleReconnect]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect]);

  return { isConnected };
}
