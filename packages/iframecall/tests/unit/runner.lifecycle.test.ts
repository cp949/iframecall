/**
 * iframe-side runner의 dispose와 terminated lifecycle 정리 동작을 검증한다.
 * 종료 이후 command, notify, response가 다시 전송되지 않는지 확인한다.
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

describe("검증: runner dispose", () => {
  it("동작: runner.dispose() 후 새 command는 처리되지 않고 response를 보내지 않는다", async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const responses: unknown[] = [];
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    runner.dispose("test");

    // dispose 후 host가 직접 request를 inject해도 runner는 무시해야 한다
    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "id-1",
        cmd: "sum",
        args: [1, 2],
      },
      origin: "https://host.example.com",
      source: hostSource,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(responses).toEqual([]);
  });

  it("동작: runner.dispose() 후 진행 중인 command settle 이후 response를 보내지 않는다", async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const responses: unknown[] = [];
    let resolveSum!: (value: number) => void;
    class PendingCommands {
      sum(_a: number, _b: number) {
        return new Promise<number>((resolve) => {
          resolveSum = resolve;
        });
      }

      async fail() {
        throw new Error("Should not run.");
      }
    }
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: PendingCommands,
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    // command 실행 중인 상태를 만들기 위해 올바른 source로 request inject
    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "id-1",
        cmd: "sum",
        args: [1, 2],
      },
      origin: "https://host.example.com",
      source: hostSource,
    });
    await Promise.resolve();

    // command 진행 중 dispose
    runner.dispose("test");

    // command settle - dispose 이후이므로 response를 보내지 않아야 한다
    resolveSum(3);
    await Promise.resolve();
    await Promise.resolve();

    expect(responses).toEqual([]);
  });

  it("동작: runner.dispose() 후 notify는 no-op이 된다", () => {
    const { host, iframe } = createLinkedTransports();
    const notifies: unknown[] = [];
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

    controller.onNotificationFromIframe("someEvent", (payload) => {
      notifies.push(payload);
    });

    runner.dispose("test");
    runner.sendNotificationToHost("someEvent", { data: "value" });

    expect(notifies).toEqual([]);
  });

  it("동작: runner.dispose() 후 terminated는 no-op이 된다", () => {
    const { host, iframe } = createLinkedTransports();
    const terminatedPayloads: unknown[] = [];
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "notify" && parsed.message.event === "terminated") {
        terminatedPayloads.push(parsed.message.payload);
      }
    });

    runner.dispose("test");
    runner.terminated("manual");

    expect(terminatedPayloads).toEqual([]);
  });

  it("동작: runner.terminated() 후 새 command는 처리되지 않고 response를 보내지 않는다", async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const responses: unknown[] = [];
    const handledCommands: string[] = [];
    class TrackingCommands {
      async sum(a: number, b: number) {
        handledCommands.push("sum");
        return a + b;
      }

      async fail() {
        throw new Error("Should not run.");
      }
    }
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: TrackingCommands,
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    runner.terminated("fatal");
    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "id-1",
        cmd: "sum",
        args: [1, 2],
      },
      origin: "https://host.example.com",
      source: hostSource,
    });
    await Promise.resolve();

    expect(handledCommands).toEqual([]);
    expect(responses).toEqual([]);
  });

  it("동작: runner.terminated() 후 진행 중인 command settle 이후 response를 보내지 않는다", async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const responses: unknown[] = [];
    let resolveSum!: (value: number) => void;
    class SettlingCommands {
      sum(_a: number, _b: number) {
        return new Promise<number>((resolve) => {
          resolveSum = resolve;
        });
      }

      async fail() {
        throw new Error("Should not run.");
      }
    }
    const runner = createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: SettlingCommands,
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "id-1",
        cmd: "sum",
        args: [1, 2],
      },
      origin: "https://host.example.com",
      source: hostSource,
    });
    await Promise.resolve();

    runner.terminated("fatal");
    resolveSum(3);
    await Promise.resolve();
    await Promise.resolve();

    expect(responses).toEqual([]);
  });
});
