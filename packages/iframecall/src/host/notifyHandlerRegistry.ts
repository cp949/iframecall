// iframe -> host notify 이벤트별 handler set을 관리한다.
// register는 unsubscribe 함수를 돌려주며, 마지막 handler가 제거되면 event 키도 정리한다.
// controller closure에서 분리한 이유는 notify dispatch가 ready/terminate 상태와 직접 결합돼 있지 않기 때문이다.

import type { NotifyHandler } from "../core/types.ts";

/** 외부 노출용 notify handler 레지스트리 인터페이스. */
export type NotifyHandlerRegistry = {
  /** 이벤트 이름과 handler를 등록하고 unsubscribe 함수를 돌려준다. */
  register(event: string, handler: NotifyHandler): () => void;

  /** 등록된 모든 handler에 payload를 그대로 전달한다. handler가 없으면 no-op. */
  dispatch(event: string, payload: unknown): void;

  /** controller 종료 시 호출. 등록된 handler를 모두 비운다. */
  clear(): void;
};

/** 새 notify handler 레지스트리를 생성한다. 내부 Map은 이 closure 안에 캡슐화된다. */
export function createNotifyHandlerRegistry(): NotifyHandlerRegistry {
  const handlers = new Map<string, Set<NotifyHandler>>();

  return {
    register(event, handler) {
      const set = handlers.get(event) ?? new Set<NotifyHandler>();
      set.add(handler);
      handlers.set(event, set);

      return () => {
        set.delete(handler);

        if (set.size === 0) {
          handlers.delete(event);
        }
      };
    },
    dispatch(event, payload) {
      const set = handlers.get(event);

      if (set === undefined) {
        return;
      }

      for (const handler of set) {
        handler(payload);
      }
    },
    clear() {
      handlers.clear();
    },
  };
}
