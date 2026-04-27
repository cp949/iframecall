/**
 * RM-063: host-side controller의 inbound origin 거부 정책을 검증한다.
 * allowedOrigins에 없는 origin에서 도착한 ready notify와 response message가
 * controller ready promise, pending call promise를 resolve/reject시키지 않는지 확인한다.
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

describe("검증: controller inbound origin 거부 정책", () => {
  it("동작: 비허용 origin에서 온 ready notify는 controller.ready를 resolve시키지 않는다", async () => {
    const { host, iframeSource } = createLinkedTransports();

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      // allowedOrigins 기본값은 targetOrigin 단일 항목이므로 명시하지 않아도 동일하다.
      readyTimeoutMs: 0,
      transport: host,
    });

    // host transport에 직접 emit해 controller의 allowedOrigins 가드를 실제로 통과시킨다.
    // source는 정상(iframeSource)으로 맞추고 origin만 비허용으로 설정해 origin 가드만 격리한다.
    host.emit({
      data: createIframeCallNotify("ready", { protocolVersion: 1 }),
      origin: "https://attacker.example.com",
      source: iframeSource,
    });

    await Promise.resolve();

    // ready promise는 아직 settle되지 않아야 한다.
    await expect(
      Promise.race([controller.ready, Promise.resolve("pending")]),
    ).resolves.toBe("pending");
  });

  it("동작: 비허용 origin에서 온 response message는 pending call promise를 resolve시키지 않는다", async () => {
    const { host, iframe, iframeSource } = createLinkedTransports();

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });

    // 정상 origin으로 ready를 보내 controller를 ready 상태로 만든다.
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    await controller.ready;

    // timeoutMs: 0은 타임아웃 없음을 의미한다. Promise.race로 "아직 미결" 상태를 확인한다.
    const callPromise = controller.call("sum", [1, 2], { timeoutMs: 0 });

    // host transport에 직접 emit해 controller의 allowedOrigins 가드를 실제로 통과시킨다.
    // source는 정상(iframeSource)으로 맞추고 origin만 비허용으로 설정해 origin 가드만 격리한다.
    host.emit({
      data: createIframeCallSuccessResponse("id-1", 99),
      origin: "https://attacker.example.com",
      source: iframeSource,
    });

    await Promise.resolve();

    // response가 drop됐으므로 call promise는 아직 settle되지 않아야 한다.
    await expect(
      Promise.race([callPromise, Promise.resolve("pending")]),
    ).resolves.toBe("pending");

    // leftover promise를 정리하기 위해 dispose로 call을 terminate한다.
    await controller.dispose("test_cleanup");
    await expect(callPromise).rejects.toMatchObject({ code: "terminated" });
  });

  it("동작: 비허용 origin에서 온 response는 pending call을 reject시키지 않는다 (정상 origin response로만 settle된다)", async () => {
    const { host, iframe, iframeSource } = createLinkedTransports();

    const controller = createIframeCallController<TestCommands>({
      iframe: {} as HTMLIFrameElement,
      targetOrigin: "https://editor.example.com",
      generateId: () => "id-1",
      transport: host,
    });

    // 정상 origin으로 ready를 보낸다.
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );
    await controller.ready;

    // 회귀로 정상 response 처리가 깨지면 default 30초가 아닌 1초 안에 빠르게 실패하도록 명시 timeout을 둔다.
    const callPromise = controller.call("sum", [1, 2], { timeoutMs: 1000 });

    // host transport에 직접 emit해 controller의 allowedOrigins 가드를 실제로 통과시킨다.
    // source는 정상(iframeSource)으로 맞추고 origin만 비허용으로 설정해 origin 가드만 격리한다.
    host.emit({
      data: createIframeCallSuccessResponse("id-1", 999),
      origin: "https://evil.example.com",
      source: iframeSource,
    });
    await Promise.resolve();

    // 그 뒤 정상 origin에서 올바른 response를 보낸다 — 이것만 처리되어야 한다.
    iframe.post(
      createIframeCallSuccessResponse("id-1", 3),
      "https://host.example.com",
    );

    await expect(callPromise).resolves.toBe(3);
  });
});
