import { describe, expect, it } from "vitest";
import { SessionEventBus, type SessionEvent } from "./events";

describe("SessionEventBus", () => {
  it("delivers events only to subscribers of the same session and supports unsubscribe", () => {
    const bus = new SessionEventBus();
    const a: SessionEvent[] = [];
    const b: SessionEvent[] = [];
    const offA = bus.subscribe("s-a", (e) => a.push(e));
    bus.subscribe("s-b", (e) => b.push(e));

    bus.publish("s-a", "error", { code: "INTERNAL", message: "boom" });
    expect(a).toEqual([{ event: "error", data: { code: "INTERNAL", message: "boom" } }]);
    expect(b).toEqual([]);

    offA();
    expect(bus.listenerCount("s-a")).toBe(0);
    bus.publish("s-a", "error", { code: "INTERNAL", message: "again" });
    expect(a).toHaveLength(1);
  });
});
