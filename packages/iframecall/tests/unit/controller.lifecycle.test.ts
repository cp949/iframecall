/**
 * host-side controller의 terminated, timeout, dispose lifecycle을 검증한다.
 * pending/queued call 정리와 transport subscription cleanup, late message 차단을 확인한다.
 */
import { describe, expect, it } from "vitest";
import {
  createIframeCallController,
  createIframeCallNotify,
  createIframeCallSuccessResponse,
  parseIframeCallMessage,
} from "../../src/host/index.ts";
import { createLinkedTransports } from "./testTransport.ts";

type TestCommands = {
  sum: (a: number, b: number) => number;
};

describe("검증: iframecall controller lifecycle 동작", () => {
  it("동작: terminated notify를 받으면 pending call과 이후 call을 terminated로 거부한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    const pending = controller.call("sum", [1, 2], { timeoutMs: 0 });
    iframe.post(
      createIframeCallNotify("terminated", { reason: "fatal" }),
      "https://host.example.com",
    );

    await expect(pending).rejects.toMatchObject({ code: "terminated" });
    await expect(controller.terminated).resolves.toMatchObject({
      code: "terminated",
    });
    await expect(controller.call("sum", [1, 2])).rejects.toMatchObject({
      code: "terminated",
    });
  });
  it("동작: terminated payload의 error를 pending call의 cause로 전달한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });
    const fatalError = {
      code: "fatal",
      message: "Editor crashed.",
    };

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    const pending = controller.call("sum", [1, 2], { timeoutMs: 0 });
    iframe.post(
      createIframeCallNotify("terminated", {
        reason: "fatal",
        error: fatalError,
      }),
      "https://host.example.com",
    );

    await expect(pending).rejects.toMatchObject({
      code: "terminated",
      cause: fatalError,
    });
    await expect(controller.terminated).resolves.toMatchObject({
      code: "terminated",
      cause: fatalError,
    });
  });
  it("동작: terminated payload error가 SerializedIframeCallError shape이 아니면 cause를 비운다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    iframe.post(
      createIframeCallNotify("terminated", {
        reason: "fatal",
        error: "oops",
      }),
      "https://host.example.com",
    );

    const lifecycleError = await controller.terminated;

    expect(lifecycleError).toMatchObject({ code: "terminated" });
    expect(lifecycleError?.cause).toBeUndefined();
  });
  it("동작: terminated 이후 late response는 settled call을 되살리지 않고 late notify는 무시한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });
    const received: unknown[] = [];
    const settledCodes: string[] = [];

    controller.onNotificationFromIframe("user:cancel", (payload) => {
      received.push(payload);
    });
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    const pending = controller.call("sum", [1, 2], { timeoutMs: 0 });
    void pending.catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
      ) {
        settledCodes.push(error.code);
      }
    });
    iframe.post(
      createIframeCallNotify("terminated", { reason: "fatal" }),
      "https://host.example.com",
    );
    await expect(pending).rejects.toMatchObject({ code: "terminated" });

    iframe.post(
      createIframeCallSuccessResponse("id-1", 3),
      "https://host.example.com",
    );
    await Promise.resolve();
    iframe.post(
      createIframeCallNotify("user:cancel", { reason: "late" }),
      "https://host.example.com",
    );

    expect(settledCodes).toEqual(["terminated"]);
    expect(received).toEqual([]);
  });
  it("동작: terminated notify를 여러 번 받아도 첫 번째 종료 사유만 유지한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    iframe.post(
      createIframeCallNotify("terminated", { reason: "first" }),
      "https://host.example.com",
    );
    iframe.post(
      createIframeCallNotify("terminated", { reason: "second" }),
      "https://host.example.com",
    );

    await expect(controller.terminated).resolves.toMatchObject({
      code: "terminated",
      details: { reason: "first" },
    });
  });
  it("동작: ready timeout이 지나면 ready와 queued call을 timeout으로 거부한다", async () => {
    const { host } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      readyTimeoutMs: 1,
      transport: host,
    });

    const pending = controller.call("sum", [1, 2], { timeoutMs: 0 });

    await expect(controller.ready).rejects.toMatchObject({
      code: "timeout",
    });
    await expect(pending).rejects.toMatchObject({
      code: "timeout",
      command: "sum",
    });
  });
  it("동작: readyTimeoutMs를 생략하면 defaultTimeoutMs로 ready timeout을 적용한다", async () => {
    const { host } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      defaultTimeoutMs: 1,
      transport: host,
    });

    await expect(controller.ready).rejects.toMatchObject({
      code: "timeout",
      details: { timeoutMs: 1 },
    });
  });
  it("동작: readyTimeoutMs가 0이면 ready timeout을 만들지 않고 ready notify까지 대기한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      defaultTimeoutMs: 1,
      readyTimeoutMs: 0,
      transport: host,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      Promise.race([controller.ready, Promise.resolve("pending")]),
    ).resolves.toBe("pending");

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    await expect(controller.ready).resolves.toBeUndefined();
  });
  it("동작: readyTimeoutMs가 Infinity이면 ready timeout을 만들지 않고 ready notify까지 대기한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      defaultTimeoutMs: 1,
      readyTimeoutMs: Number.POSITIVE_INFINITY,
      transport: host,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      Promise.race([controller.ready, Promise.resolve("pending")]),
    ).resolves.toBe("pending");

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    await expect(controller.ready).resolves.toBeUndefined();
  });
  it("동작: request post가 실패하면 invalid_args로 call을 거부한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    host.failNextPost(new DOMException("Cannot clone.", "DataCloneError"));

    await expect(controller.call("sum", [1, 2])).rejects.toMatchObject({
      code: "invalid_args",
      command: "sum",
    });
  });
  it("동작: dispose는 controller의 transport subscription을 해제한다", async () => {
    const { host } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    expect(host.getListenerCount()).toBe(1);

    await controller.dispose("app_unmount");

    expect(host.getListenerCount()).toBe(0);
  });
  it("동작: terminated 이후 dispose를 호출해도 종료 상태를 바꾸지 않는다", async () => {
    const { host, iframe } = createLinkedTransports();
    const disposeRequests: unknown[] = [];
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    iframe.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "request" && parsed.message.cmd === "host:dispose") {
        disposeRequests.push(parsed.message.args[0]);
      }
    });
    iframe.post(
      createIframeCallNotify("terminated", { reason: "fatal" }),
      "https://host.example.com",
    );
    await controller.dispose("app_unmount");

    await expect(controller.terminated).resolves.toMatchObject({
      details: { reason: "fatal" },
    });
    expect(disposeRequests).toEqual([]);
  });
  it("동작: dispose를 두 번 연속 호출해도 두 번째 호출이 조용히 종료된다", async () => {
    const { host } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    await controller.dispose("app_unmount");
    // 두 번째 dispose는 throw하지 않고 no-op으로 종료되어야 한다.
    await expect(controller.dispose("app_unmount")).resolves.toBeUndefined();
  });
  it("동작: iframe terminated notify를 받으면 controller subscription을 정리한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const received: unknown[] = [];
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    controller.onNotificationFromIframe("user:cancel", (payload) => {
      received.push(payload);
    });

    expect(host.getListenerCount()).toBe(1);

    iframe.post(
      createIframeCallNotify("terminated", { reason: "fatal" }),
      "https://host.example.com",
    );
    iframe.post(
      createIframeCallNotify("user:cancel", { reason: "late" }),
      "https://host.example.com",
    );
    await controller.dispose("app_unmount");

    await expect(controller.terminated).resolves.toMatchObject({
      details: { reason: "fatal" },
    });
    expect(host.getListenerCount()).toBe(0);
    expect(received).toEqual([]);
  });
  it("동작: dispose message 전송이 실패해도 pending과 queued call을 정리하고 late notify를 무시한다", async () => {
    const queuedCase = createLinkedTransports();
    const queuedWarnings: unknown[] = [];
    const queuedController = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      logger: {
        warn(message, detail) {
          queuedWarnings.push({ message, detail });
        },
      },
      transport: queuedCase.host,
    });
    const queued = queuedController.call("sum", [1, 2], { timeoutMs: 0 });
    const queuedExpectation = expect(queued).rejects.toMatchObject({
      code: "terminated",
    });

    queuedCase.host.failNextPost(new Error("post failed"));
    await queuedController.dispose("app_unmount");

    await queuedExpectation;
    await expect(queuedController.terminated).resolves.toMatchObject({
      code: "terminated",
      details: { reason: "app_unmount" },
    });
    expect(queuedWarnings).toEqual([
      expect.objectContaining({
        message: "iframecall dispose message failed.",
      }),
    ]);

    const pendingCase = createLinkedTransports();
    const pendingWarnings: unknown[] = [];
    const pendingController = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      logger: {
        warn(message, detail) {
          pendingWarnings.push({ message, detail });
        },
      },
      transport: pendingCase.host,
    });
    const received: unknown[] = [];

    pendingController.onNotificationFromIframe("user:cancel", (payload) => {
      received.push(payload);
    });
    pendingCase.iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    const pending = pendingController.call("sum", [1, 2], { timeoutMs: 0 });
    const pendingExpectation = expect(pending).rejects.toMatchObject({
      code: "terminated",
    });

    pendingCase.host.failNextPost(new Error("post failed"));
    await pendingController.dispose("app_unmount");
    pendingCase.iframe.post(
      createIframeCallNotify("user:cancel", { reason: "late" }),
      "https://host.example.com",
    );

    await pendingExpectation;
    await expect(pendingController.terminated).resolves.toMatchObject({
      code: "terminated",
      details: { reason: "app_unmount" },
    });
    expect(received).toEqual([]);
    expect(pendingWarnings).toEqual([
      expect.objectContaining({
        message: "iframecall dispose message failed.",
      }),
    ]);
  });
});
