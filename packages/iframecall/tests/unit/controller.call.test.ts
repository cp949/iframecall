/**
 * host-side controller의 call, ready, queue 정책을 검증한다.
 * request/response correlation과 ready 전후 전송 순서, protocol version guard를 확인한다.
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

describe("검증: iframecall controller call과 ready 동작", () => {
  it("같은 id의 success response가 오면 call promise를 해결한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });

    iframe.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "request") {
        iframe.post(
          createIframeCallSuccessResponse(parsed.message.id, 3),
          "https://host.example.com",
        );
      }
    });
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    await expect(controller.call("sum", [1, 2])).resolves.toBe(3);
  });
  it("다른 id의 response는 pending call을 해결하지 않는다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      defaultTimeoutMs: 1,
      generateId: () => "id-1",
      transport: host,
    });

    iframe.subscribe(() => {
      iframe.post(
        createIframeCallSuccessResponse("other-id", 3),
        "https://host.example.com",
      );
    });
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    await expect(controller.call("sum", [1, 2])).rejects.toMatchObject({
      code: "timeout",
      command: "sum",
    });
  });
  it("동작: queue 정책이면 ready 전 call을 ready 이후 입력 순서대로 전송한다", async () => {
    const { host, iframe } = createLinkedTransports();
    let nextId = 0;
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => `id-${++nextId}`,
      transport: host,
    });
    const sentCommands: string[] = [];

    iframe.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "request") {
        sentCommands.push(parsed.message.id);
        iframe.post(
          createIframeCallSuccessResponse(
            parsed.message.id,
            sentCommands.length,
          ),
          "https://host.example.com",
        );
      }
    });

    const first = controller.call("sum", [1, 2], { timeoutMs: 0 });
    const second = controller.call("sum", [3, 4], { timeoutMs: 0 });

    expect(sentCommands).toEqual([]);

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    await expect(controller.ready).resolves.toBeUndefined();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(sentCommands).toEqual(["id-1", "id-2"]);
  });
  it("동작: reject 정책이면 ready 전 call을 즉시 거부한다", async () => {
    const { host } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      readyPolicy: "reject",
      transport: host,
    });

    await expect(controller.call("sum", [1, 2])).rejects.toMatchObject({
      code: "not_ready",
      command: "sum",
    });
  });
  it("동작: ready queue limit을 넘으면 queue_overflow로 call을 거부한다", async () => {
    const { host } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      readyQueueLimit: 1,
      transport: host,
    });

    void controller.call("sum", [1, 2], { timeoutMs: 0 });

    await expect(controller.call("sum", [3, 4])).rejects.toMatchObject({
      code: "queue_overflow",
      command: "sum",
    });
  });
  it("동작: controller.ready는 ready notify 전에는 대기하고 ready 이후 resolve된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const observed: string[] = [];

    void controller.ready.then(() => {
      observed.push("ready");
    });
    await Promise.resolve();
    expect(observed).toEqual([]);

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    await controller.ready;

    expect(observed).toEqual(["ready"]);
  });
  it("동작: ready 이후 controller.ready를 다시 await하면 즉시 resolve된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    await expect(controller.ready).resolves.toBeUndefined();
    await expect(controller.ready).resolves.toBeUndefined();
  });
  it("동작: ready 이후 call은 즉시 request로 전송되고 response로 resolve된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });
    const sentCommands: string[] = [];

    iframe.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "request") {
        sentCommands.push(parsed.message.id);
        iframe.post(
          createIframeCallSuccessResponse(parsed.message.id, 3),
          "https://host.example.com",
        );
      }
    });
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    await expect(
      controller.call("sum", [1, 2], { timeoutMs: 0 }),
    ).resolves.toBe(3);
    expect(sentCommands).toEqual(["id-1"]);
  });
  it("동작: ready notify를 두 번 받으면 두 번째 ready는 무시하고 warning을 남긴다", async () => {
    const { host, iframe } = createLinkedTransports();
    const warnings: unknown[] = [];
    let nextId = 0;
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => `id-${++nextId}`,
      logger: {
        warn(message, detail) {
          warnings.push({ message, detail });
        },
      },
      transport: host,
    });
    const sentCommands: string[] = [];

    iframe.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "request") {
        sentCommands.push(parsed.message.id);
        iframe.post(
          createIframeCallSuccessResponse(
            parsed.message.id,
            sentCommands.length,
          ),
          "https://host.example.com",
        );
      }
    });
    const queued = controller.call("sum", [1, 2], { timeoutMs: 0 });

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    await expect(controller.ready).resolves.toBeUndefined();
    await expect(queued).resolves.toBe(1);
    expect(sentCommands).toEqual(["id-1"]);
    expect(warnings).toEqual([
      {
        message: "iframecall duplicate ready ignored.",
        detail: { protocolVersion: 1 },
      },
    ]);
  });
  it("동작: ready protocolVersion이 1이 아니면 version_mismatch로 종료한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const pending = controller.call("sum", [1, 2], { timeoutMs: 0 });
    const pendingExpectation = expect(pending).rejects.toMatchObject({
      code: "version_mismatch",
    });

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 2 }),
      "https://host.example.com",
    );

    await expect(controller.ready).rejects.toMatchObject({
      code: "version_mismatch",
    });
    await expect(controller.terminated).resolves.toMatchObject({
      code: "version_mismatch",
    });
    await pendingExpectation;
  });
  it("지원하지 않는 wire version의 inbound message는 종료하지 않고 무시한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      readyTimeoutMs: 0,
      transport: host,
    });
    const received: unknown[] = [];

    controller.onNotificationFromIframe("user:cancel", (payload) => {
      received.push(payload);
    });
    iframe.post(
      {
        protocol: "iframecall",
        version: 2,
        event: "user:cancel",
        payload: { reason: "wrong-version" },
      },
      "https://host.example.com",
    );

    expect(received).toEqual([]);
    await expect(
      Promise.race([controller.terminated, Promise.resolve("open")]),
    ).resolves.toBe("open");
  });
});
