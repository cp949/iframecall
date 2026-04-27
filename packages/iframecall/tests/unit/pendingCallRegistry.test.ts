/**
 * pending call 레지스트리의 add/settle/post/rejectAll/delete 동작을 검증한다.
 * testTransport를 재사용해 transport.post 실패 경로(invalid_args)와 정상 송신 경로를 모두 단위로 검증한다.
 */
import { describe, expect, it, type Mock, vi } from "vitest";
import type { SerializedIframeCallError } from "../../src/host/index.ts";
import {
  createIframeCallErrorResponse,
  createIframeCallSuccessResponse,
} from "../../src/host/index.ts";
import {
  createPendingCallRegistry,
  type PendingCall,
} from "../../src/host/pendingCallRegistry.ts";
import { createLinkedTransports } from "./testTransport.ts";

/** PendingCall 헬퍼 반환 타입. resolve/reject mock에 직접 접근해 호출 인자 검증이 가능하다. */
type SpyCall = PendingCall & {
  readonly resolve: Mock<(value: unknown) => void>;
  readonly reject: Mock<(error: SerializedIframeCallError) => void>;
};

/**
 * 테스트에서 반복 사용하는 PendingCall 헬퍼.
 * resolve/reject spy와 timeoutId(null/타이머) 조합을 한 줄로 만들어 케이스 가독성을 높인다.
 */
function createCall(
  command: string,
  timeoutId: ReturnType<typeof setTimeout> | null = null,
): SpyCall {
  return {
    command,
    timeoutId,
    resolve: vi.fn<(value: unknown) => void>(),
    reject: vi.fn<(error: SerializedIframeCallError) => void>(),
  };
}

describe("검증: pendingCallRegistry", () => {
  it("동작: settle ok response는 등록된 call을 resolve로 종료하고 같은 id를 두 번 settle해도 한 번만 resolve된다", () => {
    const { host } = createLinkedTransports();
    const registry = createPendingCallRegistry(
      host,
      "https://editor.example.com",
    );
    const call = createCall("sum");

    registry.add("id-1", call);
    registry.settle("id-1", createIframeCallSuccessResponse("id-1", 3));
    registry.settle("id-1", createIframeCallSuccessResponse("id-1", 99));

    expect(call.resolve).toHaveBeenCalledTimes(1);
    expect(call.resolve).toHaveBeenCalledWith(3);
    expect(call.reject).not.toHaveBeenCalled();
  });

  it("동작: settle error response는 등록된 call을 reject한다", () => {
    const { host } = createLinkedTransports();
    const registry = createPendingCallRegistry(
      host,
      "https://editor.example.com",
    );
    const call = createCall("sum");
    const error = { code: "command_failed", message: "boom" };

    registry.add("id-1", call);
    registry.settle("id-1", createIframeCallErrorResponse("id-1", error));

    expect(call.reject).toHaveBeenCalledWith(error);
    expect(call.resolve).not.toHaveBeenCalled();
  });

  it("동작: 등록되지 않은 id를 settle하면 throw 없이 no-op이다", () => {
    const { host } = createLinkedTransports();
    const registry = createPendingCallRegistry(
      host,
      "https://editor.example.com",
    );

    expect(() =>
      registry.settle("missing", createIframeCallSuccessResponse("missing", 1)),
    ).not.toThrow();
  });

  it("동작: settle은 보관된 call의 timeoutId를 clearTimeout으로 정리한다", () => {
    vi.useFakeTimers();
    try {
      const { host } = createLinkedTransports();
      const registry = createPendingCallRegistry(
        host,
        "https://editor.example.com",
      );
      const onTimeout = vi.fn();
      const timeoutId = setTimeout(onTimeout, 1);
      const call = createCall("sum", timeoutId);

      registry.add("id-1", call);
      registry.settle("id-1", createIframeCallSuccessResponse("id-1", 3));
      vi.advanceTimersByTime(10);

      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("동작: post 실패는 등록된 call을 invalid_args로 reject하고 pending에서 제거한다", () => {
    const { host } = createLinkedTransports();
    const registry = createPendingCallRegistry(
      host,
      "https://editor.example.com",
    );
    const call = createCall("sum");

    registry.add("id-1", call);
    host.failNextPost(new DOMException("Cannot clone.", "DataCloneError"));
    registry.post("id-1", "sum", [1, 2], undefined);

    expect(call.reject).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_args", command: "sum" }),
    );
    // post 실패로 이미 정리된 call은 이후 settle에 반응하지 않아야 한다.
    registry.settle("id-1", createIframeCallSuccessResponse("id-1", 3));
    expect(call.resolve).not.toHaveBeenCalled();
  });

  it("동작: post가 성공하면 transport.post가 targetOrigin과 함께 한 번 호출된다", () => {
    const { host, iframe } = createLinkedTransports();
    const registry = createPendingCallRegistry(
      host,
      "https://editor.example.com",
    );
    const received: unknown[] = [];

    iframe.subscribe((event) => received.push(event.data));
    registry.add("id-1", createCall("sum"));
    registry.post("id-1", "sum", [1, 2], undefined);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      protocol: "iframecall",
      cmd: "sum",
      id: "id-1",
    });
  });

  it("동작: rejectAll은 buildError로 만든 에러로 모든 call을 reject하고 이후 settle에 반응하지 않는다", () => {
    const { host } = createLinkedTransports();
    const registry = createPendingCallRegistry(
      host,
      "https://editor.example.com",
    );
    const callA = createCall("sum");
    const callB = createCall("multiply");

    registry.add("id-1", callA);
    registry.add("id-2", callB);
    registry.rejectAll((command) => ({ code: "terminated", message: command }));

    expect(callA.reject).toHaveBeenCalledWith({
      code: "terminated",
      message: "sum",
    });
    expect(callB.reject).toHaveBeenCalledWith({
      code: "terminated",
      message: "multiply",
    });

    registry.settle("id-1", createIframeCallSuccessResponse("id-1", 3));
    expect(callA.resolve).not.toHaveBeenCalled();
  });

  it("동작: delete된 id는 이후 settle에서 무시된다", () => {
    const { host } = createLinkedTransports();
    const registry = createPendingCallRegistry(
      host,
      "https://editor.example.com",
    );
    const call = createCall("sum");

    registry.add("id-1", call);
    registry.delete("id-1");
    registry.settle("id-1", createIframeCallSuccessResponse("id-1", 3));

    expect(call.resolve).not.toHaveBeenCalled();
    expect(call.reject).not.toHaveBeenCalled();
  });
});
