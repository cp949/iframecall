/**
 * ready 도달 전까지 보관되는 호출 큐의 add/size/delete/flush/rejectAll 동작을 검증한다.
 * transport 의존이 없는 모듈이므로 fake forward 콜백으로 flush 순서와 재진입 안전성을 단위로 확인한다.
 */
import { describe, expect, it, type Mock, vi } from "vitest";
import type { SerializedIframeCallError } from "../../src/host/index.ts";
import {
  createReadyQueue,
  type QueuedCall,
} from "../../src/host/readyQueue.ts";

/** QueuedCall 헬퍼 반환 타입. resolve/reject mock에 직접 접근할 수 있다. */
type SpyQueuedCall = QueuedCall & {
  readonly resolve: Mock<(value: unknown) => void>;
  readonly reject: Mock<(error: SerializedIframeCallError) => void>;
};

/**
 * 테스트 케이스에서 반복 사용하는 QueuedCall 헬퍼.
 * resolve/reject spy와 args/transfer 기본값을 함께 채워 케이스 본문을 단순화한다.
 */
function createQueuedCall(
  command: string,
  args: readonly unknown[] = [],
  timeoutId: ReturnType<typeof setTimeout> | null = null,
): SpyQueuedCall {
  return {
    command,
    timeoutId,
    args,
    resolve: vi.fn<(value: unknown) => void>(),
    reject: vi.fn<(error: SerializedIframeCallError) => void>(),
  };
}

describe("검증: readyQueue", () => {
  it("동작: add 후 size는 누적 호출 수를 반환하고 delete 시 감소한다", () => {
    const queue = createReadyQueue();

    queue.add("id-1", createQueuedCall("sum"));
    queue.add("id-2", createQueuedCall("multiply"));
    expect(queue.size()).toBe(2);

    queue.delete("id-1");
    expect(queue.size()).toBe(1);
  });

  it("동작: 같은 id로 add하면 마지막 값이 덮어써진다", () => {
    const queue = createReadyQueue();
    const first = createQueuedCall("sum");
    const second = createQueuedCall("multiply");

    queue.add("id-1", first);
    queue.add("id-1", second);
    expect(queue.size()).toBe(1);

    const forwarded: Array<{ id: string; command: string }> = [];
    queue.flush((id, call) => forwarded.push({ id, command: call.command }));
    expect(forwarded).toEqual([{ id: "id-1", command: "multiply" }]);
  });

  it("동작: flush는 등록 순서대로 forward를 호출하고 큐를 비운다", () => {
    const queue = createReadyQueue();
    queue.add("id-1", createQueuedCall("first"));
    queue.add("id-2", createQueuedCall("second"));
    queue.add("id-3", createQueuedCall("third"));

    const order: string[] = [];
    queue.flush((id) => order.push(id));

    expect(order).toEqual(["id-1", "id-2", "id-3"]);
    expect(queue.size()).toBe(0);
  });

  it("동작: forward 호출 시점에는 해당 id가 이미 큐에서 제거되어 재진입 delete가 no-op이 된다", () => {
    // 핵심 안전 속성: forward callback이 진행 중인 id를 다시 건드려도 큐는 이미 비워진 상태여야 한다.
    const queue = createReadyQueue();
    queue.add("id-1", createQueuedCall("first"));
    queue.add("id-2", createQueuedCall("second"));

    const sizesDuringForward: number[] = [];
    queue.flush((id) => {
      sizesDuringForward.push(queue.size());
      // 진행 중인 id의 delete는 이미 제거됐으므로 size에 영향이 없다.
      queue.delete(id);
    });

    expect(sizesDuringForward).toEqual([1, 0]);
    expect(queue.size()).toBe(0);
  });

  it("동작: forward 안에서 rejectAll을 호출해도 진행 중인 call이 두 번 reject되지 않는다", () => {
    // 실제 시나리오: controller flush 콜백 안에서 pending.post 실패가 사용자 코드를 거쳐
    // controller.dispose → lifecycle.terminate → queue.rejectAll까지 재진입할 수 있다.
    // 이때 진행 중인 call은 이미 큐에서 빠져 있어 rejectAll의 순회 대상이 아니어야 한다.
    const queue = createReadyQueue();
    const callA = createQueuedCall("first");
    const callB = createQueuedCall("second");
    const forwarded: string[] = [];

    queue.add("id-1", callA);
    queue.add("id-2", callB);
    queue.flush((id) => {
      forwarded.push(id);
      if (id === "id-1") {
        queue.rejectAll(() => ({ code: "terminated", message: "boom" }));
      }
    });

    // 진행 중이던 id-1은 forward만 받고 reject는 받지 않는다.
    expect(forwarded).toEqual(["id-1"]);
    expect(callA.reject).not.toHaveBeenCalled();
    // 아직 forward 차례를 받지 못한 id-2는 rejectAll의 buildError 결과로 한 번만 reject된다.
    expect(callB.reject).toHaveBeenCalledTimes(1);
    expect(callB.reject).toHaveBeenCalledWith({
      code: "terminated",
      message: "boom",
    });
  });

  it("동작: rejectAll은 buildError로 모든 call을 reject하고 timeoutId를 정리한다", () => {
    vi.useFakeTimers();
    try {
      const queue = createReadyQueue();
      const onTimeoutA = vi.fn();
      const onTimeoutB = vi.fn();
      const callA = createQueuedCall("sum", [], setTimeout(onTimeoutA, 1));
      const callB = createQueuedCall("multiply", [], setTimeout(onTimeoutB, 1));

      queue.add("id-1", callA);
      queue.add("id-2", callB);
      queue.rejectAll((command) => ({
        code: "terminated",
        message: command,
      }));

      expect(callA.reject).toHaveBeenCalledWith({
        code: "terminated",
        message: "sum",
      });
      expect(callB.reject).toHaveBeenCalledWith({
        code: "terminated",
        message: "multiply",
      });

      vi.advanceTimersByTime(10);
      expect(onTimeoutA).not.toHaveBeenCalled();
      expect(onTimeoutB).not.toHaveBeenCalled();
      expect(queue.size()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("동작: delete된 id는 flush와 rejectAll에 영향을 주지 않는다", () => {
    const queue = createReadyQueue();
    const call = createQueuedCall("sum");

    queue.add("id-1", call);
    queue.delete("id-1");

    const order: string[] = [];
    queue.flush((id) => order.push(id));
    queue.rejectAll(() => ({ code: "terminated", message: "x" }));

    expect(order).toEqual([]);
    expect(call.resolve).not.toHaveBeenCalled();
    expect(call.reject).not.toHaveBeenCalled();
  });
});
