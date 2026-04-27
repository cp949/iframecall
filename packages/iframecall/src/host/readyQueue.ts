// ready 이전에 들어온 호출을 보관했다가 ready 도달 시 송신 단계로 넘긴다.
// readyQueueLimit 초과 검사와 flush 순회를 controller 본체에서 분리해 ready/terminate lifecycle만 controller에 남기게 한다.

import type {
  IframeCallCallOptions,
  SerializedIframeCallError,
} from "../core/types.ts";
import type { PendingCall } from "./pendingCallRegistry.ts";

/** ready 이전에 들어와 대기 중인 호출. flush 시 args/transfer까지 함께 송신 단계로 넘어간다. */
export type QueuedCall = PendingCall & {
  readonly args: readonly unknown[];
  readonly transfer?: IframeCallCallOptions["transfer"];
};

/** ready queue 외부 인터페이스. controller가 size, add, delete, flush, rejectAll만 알도록 한다. */
export type ReadyQueue = {
  /** 현재 대기 중인 호출 수. queue_overflow 판정에 사용된다. */
  size(): number;

  /** id를 키로 호출을 보관한다. */
  add(id: string, call: QueuedCall): void;

  /** 응답이 오기 전 timeout이나 외부 사정으로 제거할 때 사용. */
  delete(id: string): void;

  /** ready 도달 시 보관된 모든 호출을 forward에 넘긴다. forward 호출 직전에 큐에서 제거되어 재진입에도 안전하다. */
  flush(forward: (id: string, call: QueuedCall) => void): void;

  /** terminate 시 큐에 남은 모든 호출을 일괄 reject 한다. */
  rejectAll(buildError: (command: string) => SerializedIframeCallError): void;
};

/** 새 ready queue 인스턴스를 만든다. 내부 Map은 closure에 캡슐화된다. */
export function createReadyQueue(): ReadyQueue {
  const queued = new Map<string, QueuedCall>();

  function clearCallTimeout(call: QueuedCall): void {
    if (call.timeoutId !== null) {
      clearTimeout(call.timeoutId);
    }
  }

  return {
    size() {
      return queued.size;
    },
    add(id, call) {
      queued.set(id, call);
    },
    delete(id) {
      queued.delete(id);
    },
    flush(forward) {
      for (const [id, call] of queued) {
        queued.delete(id);
        forward(id, call);
      }
    },
    rejectAll(buildError) {
      for (const [, call] of queued) {
        clearCallTimeout(call);
        call.reject(buildError(call.command));
      }
      queued.clear();
    },
  };
}
