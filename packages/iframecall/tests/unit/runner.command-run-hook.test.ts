/**
 * runner가 Commands class의 `$onCommandRun` wrap hook을 자동 호출하는지 검증한다.
 * happy path / hook throw / try-finally / hook 미정의 / $ prefix dispatch 차단 5 케이스를 다룬다.
 */
import { describe, expect, it } from "vitest";
import type { IframeHelper } from "../../src/core/types.ts";
import { createIframeCallController } from "../../src/host/index.ts";
import { createIframeCallRunner } from "../../src/iframe/index.ts";
import { createLinkedTransports } from "./testTransport.ts";

type HookCommands = {
  ping(): Promise<"pong">;
  boom(): Promise<void>;
};

describe("검증: runner $onCommandRun wrap hook", () => {
  it("동작: $onCommandRun이 정의되면 dispatch가 hook으로 wrap된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const calls: string[] = [];

    class HookedCommands {
      constructor(public helper: IframeHelper<Record<string, unknown>>) {}
      async $onCommandRun(
        cmd: string,
        args: readonly unknown[],
        invoke: () => Promise<unknown>,
      ): Promise<unknown> {
        calls.push(`before:${cmd}:${JSON.stringify(args)}`);
        const result = await invoke();
        calls.push(`after:${cmd}:${JSON.stringify(result)}`);
        return result;
      }
      async ping(): Promise<"pong"> {
        return "pong";
      }
      async boom(): Promise<void> {
        throw new Error("boom");
      }
    }

    const controller = createIframeCallController<HookCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const runner = createIframeCallRunner<HookCommands>({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: HookedCommands,
    });
    runner.sendLifecycleReady();
    await controller.ready;

    await expect(controller.invoke("ping", [])).resolves.toBe("pong");
    expect(calls).toEqual([`before:ping:[]`, `after:ping:"pong"`]);
  });

  it("동작: invoke()가 throw하면 hook의 try/finally가 그대로 호출되고 host로는 command error가 전파된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const sequence: string[] = [];

    class HookedCommands {
      constructor(public helper: IframeHelper<Record<string, unknown>>) {}
      async $onCommandRun(
        cmd: string,
        _args: readonly unknown[],
        invoke: () => Promise<unknown>,
      ): Promise<unknown> {
        sequence.push(`before:${cmd}`);
        try {
          return await invoke();
        } finally {
          sequence.push(`finally:${cmd}`);
        }
      }
      async ping(): Promise<"pong"> {
        return "pong";
      }
      async boom(): Promise<void> {
        throw new Error("boom");
      }
    }

    const controller = createIframeCallController<HookCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const runner = createIframeCallRunner<HookCommands>({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: HookedCommands,
    });
    runner.sendLifecycleReady();
    await controller.ready;

    await expect(controller.invoke("boom", [])).rejects.toMatchObject({
      message: "boom",
    });
    expect(sequence).toEqual(["before:boom", "finally:boom"]);
  });

  it("동작: $onCommandRun 자체가 throw하면 host로 command error가 전파된다", async () => {
    const { host, iframe } = createLinkedTransports();

    class HookedCommands {
      constructor(public helper: IframeHelper<Record<string, unknown>>) {}
      async $onCommandRun(
        _cmd: string,
        _args: readonly unknown[],
        _invoke: () => Promise<unknown>,
      ): Promise<unknown> {
        throw new Error("hook-rejected");
      }
      async ping(): Promise<"pong"> {
        return "pong";
      }
      async boom(): Promise<void> {}
    }

    const controller = createIframeCallController<HookCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const runner = createIframeCallRunner<HookCommands>({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: HookedCommands,
    });
    runner.sendLifecycleReady();
    await controller.ready;

    await expect(controller.invoke("ping", [])).rejects.toMatchObject({
      message: "hook-rejected",
    });
  });

  it("동작: $onCommandRun이 없으면 dispatch 동작이 변경되지 않는다", async () => {
    const { host, iframe } = createLinkedTransports();

    class PlainCommands {
      constructor(public helper: IframeHelper<Record<string, unknown>>) {}
      async ping(): Promise<"pong"> {
        return "pong";
      }
      async boom(): Promise<void> {
        throw new Error("boom");
      }
    }

    const controller = createIframeCallController<HookCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const runner = createIframeCallRunner<HookCommands>({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: PlainCommands,
    });
    runner.sendLifecycleReady();
    await controller.ready;

    await expect(controller.invoke("ping", [])).resolves.toBe("pong");
    await expect(controller.invoke("boom", [])).rejects.toMatchObject({
      message: "boom",
    });
  });

  it("동작: $onCommandRun은 host로 dispatch되지 않는다 ($ prefix 필터 회귀)", async () => {
    const { host, iframe } = createLinkedTransports();

    class HookedCommands {
      constructor(public helper: IframeHelper<Record<string, unknown>>) {}
      async $onCommandRun(
        _cmd: string,
        _args: readonly unknown[],
        invoke: () => Promise<unknown>,
      ): Promise<unknown> {
        return invoke();
      }
      async ping(): Promise<"pong"> {
        return "pong";
      }
      async boom(): Promise<void> {}
    }

    const controller = createIframeCallController<
      HookCommands & { $onCommandRun: () => Promise<unknown> }
    >({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const runner = createIframeCallRunner<HookCommands>({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: HookedCommands,
    });
    runner.sendLifecycleReady();
    await controller.ready;

    await expect(
      controller.invoke("$onCommandRun", [], { timeoutMs: 50 }),
    ).rejects.toMatchObject({
      code: "command_not_found",
      command: "$onCommandRun",
    });
  });
});
