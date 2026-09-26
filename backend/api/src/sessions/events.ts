/**
 * Tiny typed in-process pub/sub keyed by session id. The SSE route
 * (GET /sessions/:id/events) subscribes; OCPP/settlement code publishes.
 */
import type { ChargingSession, MeterEvent, SettledEvent } from "@chargemesh/shared";

/** Event name -> payload, matching SESSION_SSE_EVENTS (docs/03-api.md, "SSE olayları"). */
export interface SessionEventMap {
  "session.updated": ChargingSession;
  meter: MeterEvent;
  settled: SettledEvent;
  error: { code: string; message: string };
}

export type SessionEventName = keyof SessionEventMap;

export type SessionEvent = {
  [K in SessionEventName]: { event: K; data: SessionEventMap[K] };
}[SessionEventName];

export type SessionEventListener = (event: SessionEvent) => void;

export class SessionEventBus {
  private readonly listeners = new Map<string, Set<SessionEventListener>>();

  /** Subscribes to all events of one session. Returns an unsubscribe function. */
  subscribe(sessionId: string, listener: SessionEventListener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(sessionId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(sessionId);
    };
  }

  publish<K extends SessionEventName>(sessionId: string, event: K, data: SessionEventMap[K]): void {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    const payload = { event, data } as SessionEvent;
    // Copy so listeners may unsubscribe while being notified.
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch {
        // A broken subscriber (e.g. closed SSE socket) must not affect the others.
      }
    }
  }

  listenerCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0;
  }
}
