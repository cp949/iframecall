/**
 * host-side controller의 notification subscription과 typed notification dispatch를 검증한다.
 * source/origin 필터링, unsubscribe, dispose 이후 no-op 경계를 확인한다.
 */
import { describe, expect, it } from "vitest";
import {
  createIframeCallController,
  createIframeCallNotify,
  createIframeCallSuccessResponse,
} from "../../src/host/index.ts";
import { createLinkedTransports } from "./testTransport.ts";

type TestCommands = {
  sum: (a: number, b: number) => number;
};

describe("검증: iframecall controller notification 동작", () => {
  it("동작: onNotificationFromIframe handler를 호출하고 unsubscribe 이후에는 호출하지 않는다", () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    const received: unknown[] = [];
    const unsubscribe = controller.onNotificationFromIframe(
      "user:cancel",
      (payload) => {
        received.push(payload);
      },
    );

    iframe.post(
      createIframeCallNotify("user:cancel", { reason: "button" }),
      "https://host.example.com",
    );
    unsubscribe();
    iframe.post(
      createIframeCallNotify("user:cancel", { reason: "escape" }),
      "https://host.example.com",
    );

    expect(received).toEqual([{ reason: "button" }]);
  });
  it("다른 origin이나 source에서 온 response와 notify는 무시한다", async () => {
    const { host, iframe, hostSource, iframeSource } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      defaultTimeoutMs: 1,
      generateId: () => "id-1",
      transport: host,
    });
    const received: unknown[] = [];

    controller.onNotificationFromIframe("user:cancel", (payload) => {
      received.push(payload);
    });
    host.emit({
      data: createIframeCallNotify("user:cancel", { reason: "attack" }),
      origin: "https://attacker.example.com",
      source: iframeSource,
    });
    host.emit({
      data: createIframeCallNotify("user:cancel", { reason: "wrong-source" }),
      origin: "https://editor.example.com",
      source: hostSource,
    });
    host.emit({
      data: createIframeCallNotify("ready", { protocolVersion: 1 }),
      origin: "https://editor.example.com",
      source: iframeSource,
    });
    const pending = controller.invoke("sum", [1, 2]);
    host.emit({
      data: createIframeCallSuccessResponse("id-1", 3),
      origin: "https://editor.example.com",
      source: hostSource,
    });
    iframe.post(
      createIframeCallSuccessResponse("other-id", 4),
      "https://host.example.com",
    );

    await expect(pending).rejects.toMatchObject({
      code: "timeout",
    });
    expect(received).toEqual([]);
  });
  it("동작: dispose 이후 도착한 notify는 notification handler에 전달하지 않는다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const received: unknown[] = [];

    controller.onNotificationFromIframe("user:cancel", (payload) => {
      received.push(payload);
    });
    await controller.dispose("app_unmount");
    iframe.post(
      createIframeCallNotify("user:cancel", { reason: "late" }),
      "https://host.example.com",
    );

    expect(received).toEqual([]);
  });
  it("동작: dispose 이후 onNotificationFromIframe 호출이 throw하지 않는다", async () => {
    const { host } = createLinkedTransports();
    type Notifications = { stateChanged: { isLoading: boolean } };
    const controller = createIframeCallController<TestCommands, Notifications>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    await controller.dispose("app_unmount");
    // dispose 이후에도 onNotificationFromIframe은 throw 없이 unsubscribe 함수를 반환해야 한다.
    expect(() => {
      controller.onNotificationFromIframe("stateChanged", () => {});
    }).not.toThrow();
  });
});

describe("검증: controller onNotificationFromIframe", () => {
  it("동작: event 이름과 payload를 typed handler로 전달한다", () => {
    const { host, iframe } = createLinkedTransports();
    type Notifications = { stateChanged: { isLoading: boolean } };
    const controller = createIframeCallController<TestCommands, Notifications>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const received: { isLoading: boolean }[] = [];

    controller.onNotificationFromIframe("stateChanged", (payload) => {
      received.push(payload);
    });

    iframe.post(
      createIframeCallNotify("stateChanged", { isLoading: true }),
      "https://host.example.com",
    );

    expect(received).toEqual([{ isLoading: true }]);
  });

  it("동작: 반환된 unsubscribe를 호출하면 이후 notify가 handler에 도달하지 않는다", () => {
    const { host, iframe } = createLinkedTransports();
    type Notifications = { stateChanged: { isLoading: boolean } };
    const controller = createIframeCallController<TestCommands, Notifications>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const received: { isLoading: boolean }[] = [];

    const unsubscribe = controller.onNotificationFromIframe(
      "stateChanged",
      (payload) => {
        received.push(payload);
      },
    );

    iframe.post(
      createIframeCallNotify("stateChanged", { isLoading: true }),
      "https://host.example.com",
    );
    unsubscribe();
    iframe.post(
      createIframeCallNotify("stateChanged", { isLoading: false }),
      "https://host.example.com",
    );

    expect(received).toEqual([{ isLoading: true }]);
  });

  it("동작: 같은 event의 여러 handler에 notify를 모두 전달한다", () => {
    const { host, iframe } = createLinkedTransports();
    type Notifications = { stateChanged: { isLoading: boolean } };
    const controller = createIframeCallController<TestCommands, Notifications>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const first: { isLoading: boolean }[] = [];
    const second: { isLoading: boolean }[] = [];

    controller.onNotificationFromIframe("stateChanged", (payload) => {
      first.push(payload);
    });
    controller.onNotificationFromIframe("stateChanged", (payload) => {
      second.push(payload);
    });

    iframe.post(
      createIframeCallNotify("stateChanged", { isLoading: true }),
      "https://host.example.com",
    );

    expect(first).toEqual([{ isLoading: true }]);
    expect(second).toEqual([{ isLoading: true }]);
  });
});
