/**
 * host:dispose request를 받은 runner의 종료 처리와 cleanup을 검증한다.
 * dispose 진행 중 command/notify 차단과 terminated notify, subscription 정리를 확인한다.
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

describe("검증: runner host:dispose 처리", () => {
  it("동작: host:dispose 수신 즉시 새 command를 차단한다", async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const responses: unknown[] = [];
    let resolveDispose!: () => void;
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });
    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
      onHostDispose() {
        return new Promise<void>((resolve) => {
          resolveDispose = resolve;
        });
      },
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    // dispose를 시작하되 완료하지 않음 (onHostDispose가 pending 상태)
    const disposePromise = controller.dispose("test_dispose");

    // dispose 진행 중에 새 command 전송 시도 (id를 바꿔서 다른 request로 보냄)
    // iframe transport로 직접 request를 inject한다
    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "injected-id",
        cmd: "sum",
        args: [5, 6],
      },
      origin: "https://host.example.com",
      source: hostSource,
    });

    await Promise.resolve();
    await Promise.resolve();

    // host:dispose가 수신된 직후 disposing guard가 세워져 response가 없어야 한다
    expect(responses).toEqual([]);

    // dispose 완료
    resolveDispose();
    await disposePromise;
  });

  it("동작: host:dispose 진행 중 새 command는 처리되지 않는다", async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const handledCommands: string[] = [];
    let resolveDispose!: () => void;
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    class TrackingCommands {
      async sum(a: number, b: number) {
        handledCommands.push("sum");
        return a + b;
      }

      async fail() {
        handledCommands.push("fail");
        throw new Error("Should not run.");
      }
    }
    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: TrackingCommands,
      onHostDispose() {
        return new Promise<void>((resolve) => {
          resolveDispose = resolve;
        });
      },
    });

    // dispose를 시작하되 완료하지 않음
    const disposePromise = controller.dispose("test_dispose");
    await Promise.resolve();

    // dispose 진행 중 새 request inject
    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "new-id",
        cmd: "sum",
        args: [1, 2],
      },
      origin: "https://host.example.com",
      source: hostSource,
    });

    await Promise.resolve();
    expect(handledCommands).toEqual([]);

    resolveDispose();
    await disposePromise;
  });

  it("동작: host:dispose 후 진행 중인 command settle 이후 response를 보내지 않는다", async () => {
    const { host, iframe } = createLinkedTransports();
    const responses: unknown[] = [];
    let resolveSum!: (value: number) => void;
    let resolveDispose!: () => void;
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });
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
      onHostDispose() {
        return new Promise<void>((resolve) => {
          resolveDispose = resolve;
        });
      },
    });
    runner.sendLifecycleReady();
    await controller.ready;

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
    });

    // command 실행 시작
    void controller.invoke("sum", [1, 2]).catch(() => {});
    await Promise.resolve();

    // command가 진행 중일 때 host:dispose 시작
    const disposePromise = controller.dispose("test_dispose");
    await Promise.resolve();

    // command settle - dispose 중이므로 response를 보내지 않아야 한다
    resolveSum(3);
    await Promise.resolve();
    await Promise.resolve();

    // host:dispose로 인한 terminated notify만 있어야 한다
    const nonTerminatedResponses = responses.filter((r) => {
      const resp = r as { ok?: boolean };
      return resp.ok !== undefined;
    });
    expect(nonTerminatedResponses).toEqual([]);

    resolveDispose();
    await disposePromise;
  });

  it("동작: host:dispose 진행 중 일반 notify는 보내지 않고 terminated만 보낸다", async () => {
    const { host, iframe } = createLinkedTransports();
    const notifyEvents: string[] = [];
    let resolveDispose!: () => void;
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
        return new Promise<void>((resolve) => {
          resolveDispose = resolve;
        });
      },
    });

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "notify") {
        notifyEvents.push(parsed.message.event);
      }
    });

    const disposePromise = controller.dispose("test_dispose");
    await Promise.resolve();

    runner.sendNotificationToHost("stateChanged", { isLoading: true });
    runner.sendNotificationToHost("error", {
      code: "export_failed",
      message: "failed",
    });
    await Promise.resolve();

    expect(notifyEvents).toEqual([]);

    resolveDispose();
    await disposePromise;

    expect(notifyEvents).toEqual(["terminated"]);
  });

  it("동작: host:dispose 완료 후 transport subscription이 정리된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });

    createIframeCallRunner({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });

    expect(iframe.getListenerCount()).toBe(1);
    await controller.dispose("cleanup_test");

    // dispose 완료 후 runner subscription이 정리되어 iframe listener가 남지 않아야 한다
    await expect.poll(() => iframe.getListenerCount()).toBe(0);
  });
});
