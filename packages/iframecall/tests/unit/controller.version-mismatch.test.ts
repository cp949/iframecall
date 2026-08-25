/**
 * handleReadyNotify와 isSupportedReadyPayload의 version guard 동작을 검증한다.
 *
 * 의도: unsupported ready payload 매트릭스 전체가 빠짐없이 version_mismatch lifecycle error로
 * terminate됨을 잠근다. 단일 케이스(protocolVersion: 2) 단언은 controller.invoke.test.ts에 이미
 * 있으므로, 본 spec은 매트릭스 가독성 우선으로 모든 케이스를 it.each로 모은다.
 * 두 파일 사이의 protocolVersion: 2 단언 중복은 의도된 설계다.
 */

import { describe, expect, it } from "vitest";
import {
  createIframeCallController,
  createIframeCallNotify,
} from "../../src/host/index.ts";
import { createLinkedTransports } from "./testTransport.ts";

type TestCommands = {
  sum: (a: number, b: number) => number;
};

/**
 * 비지원 ready payload를 보냈을 때 controller의 세 가지 promise를 한 번에 구성한다.
 *
 * queue 정책 기준으로 ready 전 call을 하나 큐에 넣고, 비지원 payload를 보낸 직후
 * controller.ready reject, controller.terminated resolve, pending invoke reject를
 * 각각 반환한다. 매트릭스 각 케이스에서 중복 셋업 코드를 제거하기 위해 사용한다.
 */
function setupControllerWithQueuedCall(payload: unknown) {
  const { host, iframe } = createLinkedTransports();
  const controller = createIframeCallController<TestCommands>({
    iframe: {} as HTMLIFrameElement,
    targetOrigin: "https://editor.example.com",
    transport: host,
  });

  // ready 전 invoke를 큐에 넣어 version_mismatch 시 pending invoke도 함께 reject되는지 검증한다.
  const pendingCall = controller.invoke("sum", [1, 2], { timeoutMs: 0 });

  // 비지원 ready payload 전송 — isSupportedReadyPayload가 false를 반환하게 하는 케이스들이다.
  iframe.post(
    createIframeCallNotify("ready", payload),
    "https://host.example.com",
  );

  return {
    iframe,
    readyReject: expect(controller.ready).rejects,
    terminatedResolve: expect(controller.terminated).resolves,
    pendingCallReject: expect(pendingCall).rejects,
    controller,
  };
}

describe("검증: handleReadyNotify — 비지원 protocolVersion 매트릭스", () => {
  it.each([
    ["{protocolVersion: 0}", { protocolVersion: 0 }],
    ["{protocolVersion: 2}", { protocolVersion: 2 }],
    ["{protocolVersion: -1}", { protocolVersion: -1 }],
    ["{protocolVersion: 1.5}", { protocolVersion: 1.5 }],
    ['{protocolVersion: "1"}', { protocolVersion: "1" }],
    ["{protocolVersion: null}", { protocolVersion: null }],
    ["{protocolVersion: undefined}", { protocolVersion: undefined }],
    ["{}", {}],
    ["null", null],
    ["undefined", undefined],
    ["42", 42],
    ['"ready"', "ready"],
    ["[1]", [1]],
  ])(
    "비지원 ready payload %s → version_mismatch로 ready reject, terminated resolve, pending invoke reject",
    async (_label, payload) => {
      const { readyReject, terminatedResolve, pendingCallReject } =
        setupControllerWithQueuedCall(payload);

      // 1. controller.ready는 version_mismatch로 reject된다.
      await readyReject.toMatchObject({ code: "version_mismatch" });
      // 2. controller.terminated는 version_mismatch cause로 resolve된다.
      await terminatedResolve.toMatchObject({ code: "version_mismatch" });
      // 3. 큐에 쌓인 pending call도 version_mismatch로 reject된다.
      await pendingCallReject.toMatchObject({ code: "version_mismatch" });
    },
  );
});

describe("검증: handleReadyNotify — terminate 이후 추가 ready 무효화(idempotency)", () => {
  it("version_mismatch로 terminate된 이후 {protocolVersion: 1} ready를 재전송해도 lifecycle이 바뀌지 않는다", async () => {
    // 첫 번째 비지원 payload로 terminated 상태 진입을 확인한다.
    const {
      iframe,
      readyReject,
      terminatedResolve,
      pendingCallReject,
      controller,
    } = setupControllerWithQueuedCall({ protocolVersion: 0 });

    await readyReject.toMatchObject({ code: "version_mismatch" });
    await terminatedResolve.toMatchObject({ code: "version_mismatch" });
    await pendingCallReject.toMatchObject({ code: "version_mismatch" });

    // terminate 이후 올바른 protocolVersion: 1 ready를 보내도 controller.terminated는
    // 이미 settle된 상태여야 한다 — 두 번째 resolve/reject 변동이 없어야 한다.
    iframe.post(
      createIframeCallNotify("ready", { protocolVersion: 1 }),
      "https://host.example.com",
    );

    // terminated promise가 여전히 version_mismatch로 settle되어 있어야 한다.
    await expect(controller.terminated).resolves.toMatchObject({
      code: "version_mismatch",
    });
  });
});
