/**
 * iframeHelper의 host notification, ready 전송, debug subscription 동작을 검증한다.
 * helper와 runner handle이 같은 전송 규칙을 따르고 ready notify misuse를 막는지 확인한다.
 */
import { describe, expect, it } from "vitest";
import type { IframeDebugEvent } from "../../src/core/types.ts";
import {
  createIframeCallController,
  createIframeCallNotify,
  parseIframeCallMessage,
} from "../../src/host/index.ts";
import { createIframeCallRunner } from "../../src/iframe/index.ts";
import {
  createDeviceCommandsClass,
  type DeviceCommands,
  type DeviceNotificationsToHost,
} from "./runnerFixtures.ts";
import { createLinkedTransports } from "./testTransport.ts";

describe("검증: iframeHelper sendNotificationToHost와 sendLifecycleReady", () => {
  it("동작: sendNotificationToHost는 도메인 notify를 host로 흘려보낸다", () => {
    const { host, iframe } = createLinkedTransports();
    const received: { event: string; payload: unknown }[] = [];

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "notify") {
        received.push({
          event: parsed.message.event,
          payload: parsed.message.payload,
        });
      }
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

    runner.iframeHelper.sendNotificationToHost("stateChanged", {
      isLoading: true,
    });
    runner.sendNotificationToHost("stateChanged", { isLoading: false });

    expect(received).toEqual([
      { event: "stateChanged", payload: { isLoading: true } },
      { event: "stateChanged", payload: { isLoading: false } },
    ]);
  });

  it("동작: sendLifecycleReady는 protocolVersion이 1로 고정된 ready notify를 보낸다", () => {
    const { host, iframe } = createLinkedTransports();
    const readyPayloads: unknown[] = [];

    host.subscribe((event) => {
      const parsed = parseIframeCallMessage(event.data);
      if (parsed?.type === "notify" && parsed.message.event === "ready") {
        readyPayloads.push(parsed.message.payload);
      }
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

    runner.iframeHelper.sendLifecycleReady();
    runner.sendLifecycleReady();

    expect(readyPayloads).toEqual([
      { protocolVersion: 1 },
      { protocolVersion: 1 },
    ]);
    // ready payload에 protocolVersion 외 다른 field가 섞이지 않는다는 계약을 잠근다.
    expect(Object.keys(readyPayloads[0] as object).sort()).toEqual([
      "protocolVersion",
    ]);
    // protocolVersion 값이 정확히 숫자 1인지 타입과 값 모두 단언한다.
    expect(
      typeof (readyPayloads[0] as { protocolVersion: unknown }).protocolVersion,
    ).toBe("number");
    expect(
      (readyPayloads[0] as { protocolVersion: unknown }).protocolVersion,
    ).toBe(1);
  });
});

describe("검증: iframeHelper debug subscription", () => {
  it("동작: command 정상 처리 시 received와 result만 발화하고 error는 발화하지 않는다", async () => {
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
    const events: IframeDebugEvent[] = [];
    runner.iframeHelper.debug.subscribe((event) => {
      events.push(event);
    });
    runner.sendLifecycleReady();

    await expect(controller.invoke("echo", ["hi"])).resolves.toBe("hi");

    const types = events.map((event) => event.type);
    expect(types).toEqual([
      "commandReceivedFromHost",
      "commandResultSentToHost",
    ]);
    // raw payload는 가공 없이 그대로 전달되어야 한다.
    expect(events[0]).toMatchObject({
      type: "commandReceivedFromHost",
      command: "echo",
      args: ["hi"],
    });
    expect(events[1]).toMatchObject({
      type: "commandResultSentToHost",
      command: "echo",
      value: "hi",
    });
  });

  it("동작: command가 reject하면 received와 error만 발화하고 result는 발화하지 않는다", async () => {
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
    const events: IframeDebugEvent[] = [];
    runner.iframeHelper.debug.subscribe((event) => {
      events.push(event);
    });
    runner.sendLifecycleReady();

    await expect(controller.invoke("fail", [])).rejects.toBeDefined();

    const types = events.map((event) => event.type);
    expect(types).toEqual([
      "commandReceivedFromHost",
      "commandErrorSentToHost",
    ]);
    expect(events[1]).toMatchObject({
      type: "commandErrorSentToHost",
      command: "fail",
    });
  });

  it("동작: command_not_found도 received와 error만 발화하고 result는 발화하지 않는다", async () => {
    const { host, iframe } = createLinkedTransports();
    const controller = createIframeCallController<
      DeviceCommands & { unknown: () => Promise<void> }
    >({
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
    const events: IframeDebugEvent[] = [];
    runner.iframeHelper.debug.subscribe((event) => {
      events.push(event);
    });
    runner.sendLifecycleReady();

    await expect(controller.invoke("unknown", [])).rejects.toMatchObject({
      code: "command_not_found",
    });

    const types = events.map((event) => event.type);
    expect(types).toEqual([
      "commandReceivedFromHost",
      "commandErrorSentToHost",
    ]);
  });

  it("동작: sendNotificationToHost는 notificationSentToHost를 발화한다", () => {
    const { iframe } = createLinkedTransports();
    const DeviceCommandsImpl = createDeviceCommandsClass();
    const runner = createIframeCallRunner<
      DeviceCommands,
      DeviceNotificationsToHost
    >({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: DeviceCommandsImpl,
    });
    const events: IframeDebugEvent[] = [];
    runner.iframeHelper.debug.subscribe((event) => {
      events.push(event);
    });

    runner.iframeHelper.sendNotificationToHost("stateChanged", {
      isLoading: true,
    });

    expect(events).toEqual([
      {
        type: "notificationSentToHost",
        event: "stateChanged",
        payload: { isLoading: true },
      },
    ]);
  });

  it("동작: host notify 수신은 RM-006 예약 debug event로만 관찰된다", () => {
    const { host, iframe } = createLinkedTransports();
    const DeviceCommandsImpl = createDeviceCommandsClass();
    const runner = createIframeCallRunner<
      DeviceCommands,
      DeviceNotificationsToHost
    >({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: DeviceCommandsImpl,
    });
    const events: IframeDebugEvent[] = [];
    runner.iframeHelper.debug.subscribe((event) => {
      events.push(event);
    });

    host.post(
      createIframeCallNotify("host:themeChanged", { theme: "dark" }),
      "https://editor.example.com",
    );

    expect(events).toEqual([
      {
        type: "notificationReceivedFromHost",
        event: "host:themeChanged",
        payload: { theme: "dark" },
      },
    ]);
  });

  it("동작: debug.subscribe 반환값을 호출하면 이후 이벤트가 도달하지 않는다", () => {
    const { iframe } = createLinkedTransports();
    const DeviceCommandsImpl = createDeviceCommandsClass();
    const runner = createIframeCallRunner<
      DeviceCommands,
      DeviceNotificationsToHost
    >({
      targetOrigin: "https://host.example.com",
      transport: iframe,
      Commands: DeviceCommandsImpl,
    });
    const events: IframeDebugEvent[] = [];
    const unsubscribe = runner.iframeHelper.debug.subscribe((event) => {
      events.push(event);
    });

    runner.iframeHelper.sendNotificationToHost("stateChanged", {
      isLoading: true,
    });
    unsubscribe();
    runner.iframeHelper.sendNotificationToHost("stateChanged", {
      isLoading: false,
    });

    expect(events).toHaveLength(1);
  });
});
