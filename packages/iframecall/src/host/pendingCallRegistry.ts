// 송신을 마치고 응답을 기다리는 호출들을 관리한다.
// 응답 매칭(settle), wire 송신(post), terminate 시 일괄 reject를 한 곳에 모아 controller 본체의 책임을 줄인다.

import { createIframeCallError } from "../core/errors.ts";
import { createIframeCallRequest } from "../core/messages.ts";
import type { IframeCallTransport } from "../core/transport.ts";
import type {
  IframeCallCallOptions,
  IframeCallResponse,
  SerializedIframeCallError,
} from "../core/types.ts";

/** 송신 완료 후 응답을 기다리는 호출. timeout 발생 시 정리할 timer id를 함께 보관한다. */
export type PendingCall = {
  /** 디버깅과 timeout/lifecycle 메시지에 사용할 command 이름 */
  readonly command: string;

  /** timeout 적용이 없으면 null. 응답/종료 시 clearTimeout 대상이 된다. */
  readonly timeoutId: ReturnType<typeof setTimeout> | null;

  /** call() 사용자에게 노출된 promise resolver */
  readonly resolve: (value: unknown) => void;

  /** call() 사용자에게 노출된 promise rejector */
  readonly reject: (error: SerializedIframeCallError) => void;
};

/** pending 호출 레지스트리에 노출되는 인터페이스. */
export type PendingCallRegistry = {
  /** id 기준으로 pending 호출을 등록한다. */
  add(id: string, call: PendingCall): void;

  /** 응답이 오기 전 timeout이나 외부 사정으로 제거할 때 사용. timeout id는 호출 측에서 정리한다. */
  delete(id: string): void;

  /** wire response를 받아 매칭되는 호출을 resolve/reject 한다. id가 없으면 no-op. */
  settle(id: string, response: IframeCallResponse): void;

  /** 송신을 시도하고 실패하면 해당 호출을 invalid_args로 즉시 reject 한다. */
  post(
    id: string,
    cmd: string,
    args: readonly unknown[],
    transfer: IframeCallCallOptions["transfer"] | undefined,
  ): void;

  /** terminate 시 남아 있는 모든 호출을 일괄 reject 한다. command 정보를 받아 lifecycle 에러를 보강할 수 있게 한다. */
  rejectAll(buildError: (command: string) => SerializedIframeCallError): void;

  /** response correlation에 사용. id에 해당하는 pending 호출의 command 이름을 반환하고, 없으면 undefined를 반환한다. */
  getCommand(id: string): string | undefined;
};

/** transport와 targetOrigin을 묶어 pending 호출 레지스트리를 만든다. */
export function createPendingCallRegistry(
  transport: IframeCallTransport,
  targetOrigin: string,
): PendingCallRegistry {
  const pending = new Map<string, PendingCall>();

  function clearCallTimeout(call: PendingCall): void {
    if (call.timeoutId !== null) {
      clearTimeout(call.timeoutId);
    }
  }

  return {
    add(id, call) {
      pending.set(id, call);
    },
    delete(id) {
      pending.delete(id);
    },
    settle(id, response) {
      const call = pending.get(id);

      if (call === undefined) {
        return;
      }

      pending.delete(id);
      clearCallTimeout(call);

      if (response.ok) {
        call.resolve(response.value);
        return;
      }

      call.reject(response.error);
    },
    post(id, cmd, args, transfer) {
      try {
        transport.post(
          createIframeCallRequest(id, cmd, args),
          targetOrigin,
          transfer,
        );
      } catch (error) {
        const call = pending.get(id);
        pending.delete(id);

        if (call !== undefined) {
          clearCallTimeout(call);
          call.reject(
            createIframeCallError(
              "invalid_args",
              "Failed to post command request.",
              {
                command: cmd,
                details: error,
              },
            ),
          );
        }
      }
    },
    rejectAll(buildError) {
      for (const [, call] of pending) {
        clearCallTimeout(call);
        call.reject(buildError(call.command));
      }
      pending.clear();
    },
    getCommand(id) {
      return pending.get(id)?.command;
    },
  };
}
