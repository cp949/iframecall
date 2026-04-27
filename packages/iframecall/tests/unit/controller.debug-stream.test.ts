/**
 * host controller의 debug stream을 검증한다.
 * commandSent/Result/Error/notificationReceived/readyReceived/terminatedReceived 6개 event type이
 * 정확한 시점에 정확한 payload로 발화되는지 단위 단위로 잠근다.
 */
import { describe, expect, it, vi } from "vitest";
import { createIframeCallError } from "../../src/core/errors.ts";
import {
  createIframeCallErrorResponse,
  createIframeCallNotify,
  createIframeCallSuccessResponse,
} from "../../src/core/messages.ts";
import type { HostDebugEvent } from "../../src/core/types.ts";
import { createIframeCallController } from "../../src/host/controller.ts";
import { createLinkedTransports } from "./testTransport.ts";

/**
 * controller와 매번 새 transport 쌍을 생성하는 helper.
 * 테스트가 단일 controller lifecycle만 다루므로 매 테스트가 독립된 transport를 갖도록 한다.
 * host transport는 controller에 주입하고, iframe transport는 메시지 주입에 사용한다.
 */
function createTestController() {
  const { host, iframe } = createLinkedTransports();
  const controller = createIframeCallController<{ run(): Promise<string> }>({
    iframe: {} as HTMLIFrameElement,
    targetOrigin: "https://editor.example.com",
    transport: host,
    generateId: () => "test-id",
  });
  return { controller, iframe };
}

describe("host controller debug stream", () => {
  it("subscribe는 unsubscribe 함수를 반환한다", () => {
    const { controller } = createTestController();
    const handler = vi.fn();
    const unsubscribe = controller.debug.subscribe(handler);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });

  it("call 직후 commandSentToIframe이 발화된다", async () => {
    const { controller, iframe } = createTestController();
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    const events: HostDebugEvent[] = [];
    controller.debug.subscribe((event) => events.push(event));

    void controller.call("run", []);
    await Promise.resolve();

    expect(events).toContainEqual({
      type: "commandSentToIframe",
      command: "run",
      args: [],
    });
  });

  it("정상 response 시 commandResultReceivedFromIframe이 발화된다", async () => {
    const { controller, iframe } = createTestController();
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    const events: HostDebugEvent[] = [];
    controller.debug.subscribe((event) => events.push(event));

    const promise = controller.call("run", []);
    iframe.post(
      createIframeCallSuccessResponse("test-id", "ok"),
      "https://host.example.com",
    );
    await promise;

    expect(events).toContainEqual({
      type: "commandResultReceivedFromIframe",
      command: "run",
      value: "ok",
    });
  });

  it("error response 시 commandErrorReceivedFromIframe이 발화된다", async () => {
    const { controller, iframe } = createTestController();
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    const events: HostDebugEvent[] = [];
    controller.debug.subscribe((event) => events.push(event));

    const promise = controller.call("run", []);
    const serializedError = createIframeCallError("invalid_args", "boom", {
      command: "run",
    });
    iframe.post(
      createIframeCallErrorResponse("test-id", serializedError),
      "https://host.example.com",
    );
    await expect(promise).rejects.toBeDefined();

    const errorEvent = events.find(
      (event) => event.type === "commandErrorReceivedFromIframe",
    );
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({
      command: "run",
      error: { code: "invalid_args" },
    });
  });

  it("도메인 notification 수신 시 notificationReceivedFromIframe이 발화된다", () => {
    const { controller, iframe } = createTestController();
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    const events: HostDebugEvent[] = [];
    controller.debug.subscribe((event) => events.push(event));

    iframe.post(
      createIframeCallNotify("stateChanged", { dirty: true }),
      "https://host.example.com",
    );

    expect(events).toContainEqual({
      type: "notificationReceivedFromIframe",
      event: "stateChanged",
      payload: { dirty: true },
    });
  });

  it("ready notify 수신 시 readyReceived가 발화된다", () => {
    const { controller, iframe } = createTestController();
    const events: HostDebugEvent[] = [];
    controller.debug.subscribe((event) => events.push(event));

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    expect(events).toContainEqual({
      type: "readyReceived",
      payload: { protocolVersion: 1 },
    });
  });

  it("terminated notify 수신 시 terminatedReceived가 발화된다", () => {
    const { controller, iframe } = createTestController();
    const events: HostDebugEvent[] = [];
    controller.debug.subscribe((event) => events.push(event));

    iframe.post(
      createIframeCallNotify("terminated", { reason: "iframe_unload" }),
      "https://host.example.com",
    );

    const terminated = events.find(
      (event) => event.type === "terminatedReceived",
    );
    expect(terminated).toBeDefined();
    expect(terminated).toMatchObject({
      reason: "iframe_unload",
    });
  });

  it("subscriber가 throw해도 다른 subscriber와 controller 동작에 영향이 없다", () => {
    const { controller, iframe } = createTestController();
    const broken = vi.fn(() => {
      throw new Error("subscriber boom");
    });
    const ok = vi.fn();
    controller.debug.subscribe(broken);
    controller.debug.subscribe(ok);

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    expect(broken).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled();
  });

  it("unsubscribe 후에는 더 이상 호출되지 않는다", () => {
    const { controller, iframe } = createTestController();
    const handler = vi.fn();
    const unsubscribe = controller.debug.subscribe(handler);
    unsubscribe();

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    expect(handler).not.toHaveBeenCalled();
  });
});
