/**
 * iframe-side runner의 기본 command 실행과 controller 연동 흐름을 검증한다.
 * command 성공/실패, 미등록 command, notify 전달, host dispose 요청 처리를 확인한다.
 */
import { describe, expect, it } from "vitest";
import {
  createIframeCallController,
  parseIframeCallMessage,
} from "../../src/host/index.ts";
import { createIframeCallRunner } from "../../src/iframe/index.ts";
import {
  createBasicRunnerCommandsClass,
  type TestCommands,
} from "./runnerFixtures.ts";
import { createLinkedTransports } from "./testTransport.ts";

describe("검증: iframecall runner 동작", () => {
  it("동작: host call을 command handler로 전달하고 async return value를 돌려준다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });

    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });
    runner.sendLifecycleReady();

    await expect(controller.invoke("sum", [1, 2])).resolves.toBe(3);
  });

  it("동작: command handler가 throw하면 serialized error response를 돌려준다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });

    class FailingCommands {
      async sum(a: number, b: number) {
        return a + b;
      }

      async fail() {
        throw new TypeError("Broken command.");
      }
    }
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: FailingCommands,
    });
    runner.sendLifecycleReady();

    await expect(controller.invoke("fail", [])).rejects.toEqual({
      code: "command_failed",
      message: "Broken command.",
      command: "fail",
      details: { name: "TypeError" },
    });
  });

  it("등록되지 않은 command이면 command_not_found 에러를 돌려준다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });

    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });
    runner.sendLifecycleReady();

    await expect(
      controller.invoke("missing" as keyof TestCommands & string, []),
    ).rejects.toMatchObject({
      code: "command_not_found",
      command: "missing",
    });
  });

  it("동작: runner notify를 controller subscription으로 전달한다", () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });
    const received: unknown[] = [];

    controller.onNotificationFromIframe("user:cancel", (payload) => {
      received.push(payload);
    });
    runner.sendNotificationToHost("user:cancel", { reason: "button" });

    expect(received).toEqual([{ reason: "button" }]);
  });

  it("동작: controller dispose가 runner onHostDispose를 실행하고 terminated를 전달한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const disposed: string[] = [];
    const terminatedReasons: unknown[] = [];
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
      onHostDispose() {
        disposed.push("called");
      },
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "notify" && parsed.message.event === "terminated") {
        terminatedReasons.push(parsed.message.payload);
      }
    });
    runner.sendLifecycleReady();
    await controller.dispose();
    await Promise.resolve();

    expect(disposed).toEqual(["called"]);
    expect(terminatedReasons).toEqual([{ reason: "host_requested" }]);
  });

  it("동작: controller dispose reason을 host:dispose payload와 terminated notify에 반영한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const hostDisposeCalls: string[] = [];
    const domainDisposeCalls: string[] = [];
    const requestPayloads: unknown[] = [];
    const terminatedPayloads: unknown[] = [];
    const responses: unknown[] = [];
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    class CommandsWithReservedSentinel {
      async sum(a: number, b: number) {
        return a + b;
      }

      async fail() {
        throw new Error("Should not run.");
      }

      // 예약 command 이름 노출 회귀를 computed key 형태로 검증한다.
      async ["host:dispose"]() {
        domainDisposeCalls.push("called");
      }
    }

    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: CommandsWithReservedSentinel,
      onHostDispose() {
        hostDisposeCalls.push("called");
      },
    });

    iframe.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "request" && parsed.message.cmd === "host:dispose") {
        requestPayloads.push(parsed.message.args[0]);
      }
    });
    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "notify" && parsed.message.event === "terminated") {
        terminatedPayloads.push(parsed.message.payload);
      }

      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    await controller.dispose("app_unmount");

    expect(requestPayloads).toEqual([{ reason: "app_unmount" }]);
    expect(hostDisposeCalls).toEqual(["called"]);
    await expect
      .poll(() => terminatedPayloads)
      .toEqual([{ reason: "app_unmount" }]);
    expect(domainDisposeCalls).toEqual([]);
    expect(responses).toEqual([]);
    await expect(controller.terminated).resolves.toMatchObject({
      code: "terminated",
      details: { reason: "app_unmount" },
    });
  });

  it("동작: onHostDispose가 reject해도 terminated notify를 보내고 warning을 남긴다", async () => {
    const { host, iframe } = createLinkedTransports();
    const warnings: unknown[] = [];
    const terminatedPayloads: unknown[] = [];
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      logger: {
        warn(message, detail) {
          warnings.push({ message, detail });
        },
      },
      Commands: createBasicRunnerCommandsClass(),
      async onHostDispose() {
        await Promise.resolve();
        throw new Error("dispose failed");
      },
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "notify" && parsed.message.event === "terminated") {
        terminatedPayloads.push(parsed.message.payload);
      }
    });

    await controller.dispose("app_unmount");

    await expect
      .poll(() => terminatedPayloads)
      .toEqual([{ reason: "app_unmount" }]);
    await expect.poll(() => warnings.length).toBe(1);
    expect(warnings[0]).toMatchObject({
      message: "iframecall host dispose handler failed.",
    });
  });

  it("동작: onHostDispose가 동기 throw해도 terminated notify를 보내고 warning을 남긴다", async () => {
    const { host, iframe } = createLinkedTransports();
    const warnings: unknown[] = [];
    const terminatedPayloads: unknown[] = [];
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      logger: {
        warn(message, detail) {
          warnings.push({ message, detail });
        },
      },
      Commands: createBasicRunnerCommandsClass(),
      onHostDispose() {
        throw new Error("dispose failed");
      },
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);

      if (parsed?.type === "notify" && parsed.message.event === "terminated") {
        terminatedPayloads.push(parsed.message.payload);
      }
    });

    await controller.dispose("app_unmount");

    await expect
      .poll(() => terminatedPayloads)
      .toEqual([{ reason: "app_unmount" }]);
    await expect.poll(() => warnings.length).toBe(1);
    expect(warnings[0]).toMatchObject({
      message: "iframecall host dispose handler failed.",
    });
  });
});
