/**
 * runner의 Commands class API와 command collection 규칙을 검증한다.
 * prototype-only dispatch, this binding, 예약 command 제외(`_`/`$` prefix 포함), runtime option guard를 확인한다.
 */
import { describe, expect, it } from "vitest";
import type { IframeHelper } from "../../src/core/types.ts";
import {
  createIframeCallController,
  parseIframeCallMessage,
} from "../../src/host/index.ts";
import { createIframeCallRunner } from "../../src/iframe/index.ts";
import {
  createDeviceCommandsClass,
  type DeviceCommands,
  type DeviceNotificationsToHost,
} from "./runnerFixtures.ts";
import { createLinkedTransports } from "./testTransport.ts";

describe("검증: runner Commands class API", () => {
  it("동작: Commands class를 받으면 new Commands(iframeHelper)로 한 번 인스턴스화한다", () => {
    const { iframe } = createLinkedTransports();
    const constructions: number[] = [];
    const injectedHelpers: IframeHelper<DeviceNotificationsToHost>[] = [];

    class TrackedCommands {
      constructor(helper: IframeHelper<DeviceNotificationsToHost>) {
        constructions.push(constructions.length + 1);
        injectedHelpers.push(helper);
      }
      async ping(): Promise<"pong"> {
        return "pong";
      }
    }

    const runner = createIframeCallRunner<
      { ping(): Promise<"pong"> },
      DeviceNotificationsToHost
    >({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: TrackedCommands,
    });

    expect(constructions).toEqual([1]);
    expect(runner.commands).toBeInstanceOf(TrackedCommands);
    expect(runner.iframeHelper).toBe(injectedHelpers[0]);
  });

  it("동작: runner.commands와 runner.iframeHelper는 인스턴스/주입 reference를 그대로 노출한다", () => {
    const { iframe } = createLinkedTransports();
    const DeviceCommands = createDeviceCommandsClass();
    const runner = createIframeCallRunner<
      DeviceCommands,
      DeviceNotificationsToHost
    >({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: DeviceCommands,
    });

    expect(runner.commands).toBeInstanceOf(DeviceCommands);
    // 인스턴스 field로 보관된 helper reference가 runner.iframeHelper와 같아야 this binding이 유지된다.
    const commandsRecord = runner.commands as unknown as Record<
      string,
      unknown
    >;
    expect(commandsRecord.iframeHelper).toBe(runner.iframeHelper);
    // sendNotificationToHost helper와 runner handle은 동일 동작을 노출한다.
    expect(typeof runner.sendNotificationToHost).toBe("function");
    expect(typeof runner.sendLifecycleReady).toBe("function");
  });

  it("동작: prototype method를 host command로 dispatch하며 this binding을 유지한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<DeviceCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });
    const DeviceCommandsImpl = createDeviceCommandsClass();
    const runner = createIframeCallRunner<
      DeviceCommands,
      DeviceNotificationsToHost
    >({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: DeviceCommandsImpl,
    });
    runner.sendLifecycleReady();

    await expect(controller.call("ping", [])).resolves.toBe("pong");
    await expect(controller.call("echo", ["hi"])).resolves.toBe("hi");
    // this.state 접근이 깨지지 않아야 readState가 인스턴스 field 값을 반환한다.
    await expect(controller.call("readState", [])).resolves.toBe("ready");
  });

  it("동작: instance field 함수, _ prefix, $ prefix, accessor, static, symbol-keyed, host:dispose는 command_not_found가 된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<
      DeviceCommands & {
        onInstance: () => Promise<string>;
        _hidden: () => Promise<string>;
        $probe: () => Promise<string>;
        onGetter: () => Promise<number>;
        onStatic: () => Promise<string>;
        "host:dispose": () => Promise<void>;
      }
    >({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const DeviceCommandsImpl = createDeviceCommandsClass();
    const runner = createIframeCallRunner<
      DeviceCommands,
      DeviceNotificationsToHost
    >({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: DeviceCommandsImpl,
    });
    runner.sendLifecycleReady();
    await controller.ready;

    for (const hidden of [
      "onInstance",
      "_hidden",
      "$probe",
      "onGetter",
      "onStatic",
    ] as const) {
      await expect(
        controller.call(hidden, [], { timeoutMs: 50 }),
      ).rejects.toMatchObject({
        code: "command_not_found",
        command: hidden,
      });
    }
  });

  it("동작: prototype에 host:dispose가 있어도 transport 수신 시 dispose lifecycle로 라우팅되어 command_not_found를 반환하지 않는다", async () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const responses: unknown[] = [];
    const terminatedPayloads: unknown[] = [];

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "response") {
        responses.push(parsed.message);
      }
      if (parsed?.type === "notify" && parsed.message.event === "terminated") {
        terminatedPayloads.push(parsed.message.payload);
      }
    });

    const DeviceCommandsImpl = createDeviceCommandsClass();
    // Commands class fixture prototype에 host:dispose method가 실제로 존재함을 먼저 확인한다.
    expect(Object.hasOwn(DeviceCommandsImpl.prototype, "host:dispose")).toBe(
      true,
    );

    createIframeCallRunner<DeviceCommands, DeviceNotificationsToHost>({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: DeviceCommandsImpl,
    });

    // transport에 직접 host:dispose request를 inject한다.
    // runner는 이를 command dispatch가 아닌 lifecycle 경로로 처리해야 한다.
    // 따라서 command_not_found response가 아닌 terminated notify가 도착해야 한다.
    iframe.emit({
      data: {
        protocol: "iframecall",
        version: 1,
        id: "probe-id",
        cmd: "host:dispose",
        args: [{ reason: "test" }],
      },
      origin: "https://host.example.com",
      source: hostSource,
    });
    await Promise.resolve();
    await Promise.resolve();

    // command_not_found response가 아닌 terminated notify만 발생해야 한다.
    expect(responses).toHaveLength(0);
    expect(terminatedPayloads).toEqual([{ reason: "test" }]);
  });

  it("동작: fixture prototype의 symbol key는 실재하지만 runner command collection에서 제외된다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<
      DeviceCommands & { [key: symbol]: () => Promise<string> }
    >({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      transport: host,
    });
    const DeviceCommandsImpl = createDeviceCommandsClass();

    // fixture prototype에 symbol key가 실제로 존재함을 먼저 확인한다.
    const symbolKeys = Reflect.ownKeys(DeviceCommandsImpl.prototype).filter(
      (key) => typeof key === "symbol",
    );
    expect(symbolKeys.length).toBeGreaterThan(0);

    const runner = createIframeCallRunner<
      DeviceCommands,
      DeviceNotificationsToHost
    >({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: DeviceCommandsImpl,
    });
    runner.sendLifecycleReady();
    await controller.ready;

    // runner.commands 인스턴스에 symbol key가 없어야 command dispatch 대상에서 제외된다.
    const instanceSymbolKeys = Reflect.ownKeys(
      runner.commands as object,
    ).filter((key) => typeof key === "symbol");
    expect(instanceSymbolKeys).toEqual([]);
  });

  it("동작: 기본 Commands class는 prototype에 symbol key를 노출하지 않는다", () => {
    // 일반적인 Commands 정의에서 prototype에 symbol key가 끼어들지 않는다는 회귀 검증이다.
    // 명시적으로 symbol method를 둔 fixture는 dispatch에서 막히는지를 별도로 검증한다.
    class VanillaCommands {
      async ping(): Promise<"pong"> {
        return "pong";
      }
    }
    const symbolKeys = Reflect.ownKeys(VanillaCommands.prototype).filter(
      (key) => typeof key === "symbol",
    );

    expect(symbolKeys).toEqual([]);
  });

  it("동작: 제거된 commands object 옵션이 전달되면 invalid_args로 throw한다", () => {
    const { iframe } = createLinkedTransports();

    let caught: unknown = null;
    try {
      // 제거된 object-map 옵션을 unknown cast로 강제해 runtime guard도 함께 검증한다.
      createIframeCallRunner({
        targetOrigin: "https://host.example.com",
        transport: iframe,
        commands: { ping: async () => "pong" as const },
      } as unknown as Parameters<typeof createIframeCallRunner>[0]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "invalid_args",
      message:
        "createIframeCallRunner no longer accepts { commands }. Use { Commands } class.",
    });
  });

  it("동작: Commands를 누락하면 invalid_args로 throw한다", () => {
    const { iframe } = createLinkedTransports();

    let caught: unknown = null;
    try {
      createIframeCallRunner({
        targetOrigin: "https://host.example.com",
        transport: iframe,
      } as unknown as Parameters<typeof createIframeCallRunner>[0]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "invalid_args",
      message: "createIframeCallRunner requires { Commands } class.",
    });
  });
});
