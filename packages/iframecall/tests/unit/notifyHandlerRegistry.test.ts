/**
 * iframe -> host notify handler 레지스트리의 register/dispatch/clear 동작을 검증한다.
 * 동일 이벤트에 여러 handler 등록, 마지막 handler 제거 시 키 정리, 등록되지 않은 이벤트 dispatch가 no-op인지 확인한다.
 */
import { describe, expect, it } from "vitest";
import { createNotifyHandlerRegistry } from "../../src/host/notifyHandlerRegistry.ts";

describe("검증: notifyHandlerRegistry", () => {
  it("동작: 등록한 handler에 dispatch payload가 그대로 전달된다", () => {
    const registry = createNotifyHandlerRegistry();
    const received: unknown[] = [];

    registry.register("user:cancel", (payload) => {
      received.push(payload);
    });
    registry.dispatch("user:cancel", { reason: "esc" });

    expect(received).toEqual([{ reason: "esc" }]);
  });

  it("동작: 동일 이벤트에 등록한 모든 handler에 순서대로 dispatch한다", () => {
    const registry = createNotifyHandlerRegistry();
    const order: string[] = [];

    registry.register("user:cancel", () => order.push("first"));
    registry.register("user:cancel", () => order.push("second"));
    registry.dispatch("user:cancel", null);

    expect(order).toEqual(["first", "second"]);
  });

  it("동작: register가 돌려준 unsubscribe만 호출하면 해당 handler만 제거된다", () => {
    const registry = createNotifyHandlerRegistry();
    const calls: string[] = [];

    const unsubscribeFirst = registry.register("user:cancel", () =>
      calls.push("first"),
    );
    registry.register("user:cancel", () => calls.push("second"));

    unsubscribeFirst();
    registry.dispatch("user:cancel", null);

    expect(calls).toEqual(["second"]);
  });

  it("동작: 마지막 handler를 제거하면 이후 dispatch가 no-op이 된다", () => {
    const registry = createNotifyHandlerRegistry();
    let dispatched = false;

    const unsubscribe = registry.register("user:cancel", () => {
      dispatched = true;
    });
    unsubscribe();
    registry.dispatch("user:cancel", null);

    expect(dispatched).toBe(false);
  });

  it("동작: 등록되지 않은 이벤트 dispatch는 throw 없이 no-op이다", () => {
    const registry = createNotifyHandlerRegistry();

    expect(() => registry.dispatch("never-registered", null)).not.toThrow();
  });

  it("동작: clear 이후에는 기존 handler가 더 이상 호출되지 않는다", () => {
    const registry = createNotifyHandlerRegistry();
    const received: unknown[] = [];

    registry.register("user:cancel", (payload) => received.push(payload));
    registry.clear();
    registry.dispatch("user:cancel", { reason: "after-clear" });

    expect(received).toEqual([]);
  });

  it("동작: 동일 handler 함수를 두 번 등록해도 Set 의미상 한 번만 dispatch된다", () => {
    const registry = createNotifyHandlerRegistry();
    let count = 0;
    const handler = () => {
      count += 1;
    };

    registry.register("user:cancel", handler);
    registry.register("user:cancel", handler);
    registry.dispatch("user:cancel", null);

    expect(count).toBe(1);
  });
});
