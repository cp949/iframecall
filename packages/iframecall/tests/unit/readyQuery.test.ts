/**
 * TRP-0004(host 구독 전에 도착한 ready 유실)의 근본 해결인 ready 재요청 handshake를 검증한다.
 * host controller는 구독 직후 `host:ready-query` notify를 한 번 보내고,
 * 이미 ready를 보낸 runner는 `requested: true`가 붙은 ready로 다시 응답한다.
 * 기존 runner/host와 섞여도 동작이 지금과 같게 유지되는지도 함께 확인한다.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createIframeCallController,
  createIframeCallNotify,
  parseIframeCallMessage,
} from "../../src/host/index.ts";
import { createIframeCallRunner } from "../../src/iframe/index.ts";
import {
  createBasicRunnerCommandsClass,
  type TestCommands,
} from "./runnerFixtures.ts";
import { createLinkedTransports } from "./testTransport.ts";

const HOST_ORIGIN = "https://host.example.com";
const IFRAME_ORIGIN = "https://editor.example.com";

/**
 * host transport에 도착한 ready notify payload만 모은다.
 * runner가 ready를 몇 번, 어떤 payload로 보냈는지 관찰할 때 사용한다.
 */
function collectReadyPayloads(
  host: ReturnType<typeof createLinkedTransports>["host"],
): unknown[] {
  const payloads: unknown[] = [];
  host.subscribe((event) => {
    const parsed = parseIframeCallMessage(event.data);
    if (parsed?.type === "notify" && parsed.message.event === "ready") {
      payloads.push(parsed.message.payload);
    }
  });
  return payloads;
}

/**
 * runner transport에 host가 보낸 것처럼 ready-query notify를 주입한다.
 * origin/source를 바꿔 runner의 수신 검증이 query에도 적용되는지 확인한다.
 */
function emitReadyQuery(
  iframe: ReturnType<typeof createLinkedTransports>["iframe"],
  source: unknown,
  origin = HOST_ORIGIN,
): void {
  iframe.emit({
    data: createIframeCallNotify("host:ready-query", null),
    origin,
    source,
  });
}

describe("검증: host controller의 ready 재요청", () => {
  it("구독 직후 targetOrigin으로 host:ready-query notify를 한 번 보낸다", () => {
    const { host } = createLinkedTransports();

    createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: IFRAME_ORIGIN,
      transport: host,
    });

    const posts = host.getPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.targetOrigin).toBe(IFRAME_ORIGIN);
    expect(parseIframeCallMessage(posts[0]?.message)).toMatchObject({
      type: "notify",
      message: { event: "host:ready-query" },
    });
  });

  it('opaque origin 모드에서는 ready-query를 "*"로 보낸다', () => {
    const { host } = createLinkedTransports({ iframeOrigin: "null" });

    createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      opaqueOrigin: true,
      transport: host,
    });

    expect(host.getPosts()[0]?.targetOrigin).toBe("*");
  });

  it("requested ready 중복은 경고 없이 무시하고 일반 ready 중복은 계속 경고한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const warn = vi.fn();

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: IFRAME_ORIGIN,
      logger: { warn },
      transport: host,
    });

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      HOST_ORIGIN,
    );
    await controller.ready;

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1, requested: true }),
      HOST_ORIGIN,
    );
    expect(warn).not.toHaveBeenCalled();

    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      HOST_ORIGIN,
    );
    expect(warn).toHaveBeenCalledWith(
      "iframecall duplicate ready ignored.",
      expect.anything(),
    );
  });
});

describe("검증: runner의 ready 재요청 응답", () => {
  it("ready를 보낸 runner는 ready-query에 requested ready로 다시 응답한다", () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const readyPayloads = collectReadyPayloads(host);
    const runner = createIframeCallRunner({
      targetOrigin: HOST_ORIGIN,
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });

    runner.sendLifecycleReady();
    emitReadyQuery(iframe, hostSource);

    expect(readyPayloads).toEqual([
      { protocolVersion: 1 },
      { protocolVersion: 1, requested: true },
    ]);
  });

  it("앱이 아직 ready를 보내지 않았으면 ready-query를 무시한다", () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const readyPayloads = collectReadyPayloads(host);
    createIframeCallRunner({
      targetOrigin: HOST_ORIGIN,
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });

    emitReadyQuery(iframe, hostSource);

    expect(readyPayloads).toEqual([]);
  });

  it("허용되지 않은 origin이나 다른 source의 ready-query에는 응답하지 않는다", () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const readyPayloads = collectReadyPayloads(host);
    const runner = createIframeCallRunner({
      targetOrigin: HOST_ORIGIN,
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });
    runner.sendLifecycleReady();

    emitReadyQuery(iframe, hostSource, "https://attacker.example.com");
    emitReadyQuery(iframe, { name: "other-window" });

    expect(readyPayloads).toEqual([{ protocolVersion: 1 }]);
  });

  it("dispose된 runner는 ready-query에 응답하지 않는다", () => {
    const { host, iframe, hostSource } = createLinkedTransports();
    const readyPayloads = collectReadyPayloads(host);
    const runner = createIframeCallRunner({
      targetOrigin: HOST_ORIGIN,
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });
    runner.sendLifecycleReady();
    runner.dispose("test");

    emitReadyQuery(iframe, hostSource);

    expect(readyPayloads).toEqual([{ protocolVersion: 1 }]);
  });

  it("ready-query는 도메인 notification debug 이벤트로 흘리지 않는다", () => {
    const { iframe, hostSource } = createLinkedTransports();
    const runner = createIframeCallRunner({
      targetOrigin: HOST_ORIGIN,
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });
    const debugEvents: unknown[] = [];
    runner.iframeHelper.debug.subscribe((event) => debugEvents.push(event));

    emitReadyQuery(iframe, hostSource);

    expect(debugEvents).toEqual([]);
  });
});

describe("검증: host 구독 전 ready 유실 복구 (TRP-0004)", () => {
  it("controller 생성 전에 보낸 ready가 유실돼도 ready-query 응답으로 ready에 도달한다", async () => {
    const { host, iframe } = createLinkedTransports();
    const runner = createIframeCallRunner({
      targetOrigin: HOST_ORIGIN,
      transport: iframe,
      Commands: createBasicRunnerCommandsClass(),
    });

    // host listener가 없어 이 ready는 유실된다.
    runner.sendLifecycleReady();

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: IFRAME_ORIGIN,
      readyTimeoutMs: 1000,
      transport: host,
    });

    await expect(controller.ready).resolves.toBeUndefined();
    await expect(controller.invoke("sum", [1, 2])).resolves.toBe(3);
  });

  it("ready-query를 무시하는 기존 runner와도 이후 ready로 정상 연결된다", async () => {
    const { host, iframe } = createLinkedTransports();

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: IFRAME_ORIGIN,
      readyTimeoutMs: 1000,
      transport: host,
    });

    // 기존 runner는 query에 응답하지 않고 앱이 준비될 때 ready만 보낸다.
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      HOST_ORIGIN,
    );

    await expect(controller.ready).resolves.toBeUndefined();
  });
});
