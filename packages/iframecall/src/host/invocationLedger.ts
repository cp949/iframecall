// host command invocation의 queued/pending 상태 전이와 정리를 한 곳에 모은다.
// controller는 wire/lifecycle 해석을 맡고, ledger는 deadline·송신·응답·종료에 따른 invocation promise만 소유한다.

import { createIframeCallError } from "../core/errors.ts";
import { createIframeCallRequest } from "../core/messages.ts";
import type { IframeCallTransport } from "../core/transport.ts";
import type {
  IframeCallCallOptions,
  IframeCallResponse,
  ReadyPolicy,
  SerializedIframeCallError,
} from "../core/types.ts";

type Invocation = {
  readonly command: string;
  readonly args: readonly unknown[];
  readonly transfer: IframeCallCallOptions["transfer"] | undefined;
  readonly timeoutId: ReturnType<typeof setTimeout> | null;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: SerializedIframeCallError) => void;
};

export type InvocationLedgerOptions = {
  readonly transport: IframeCallTransport;
  readonly targetOrigin: string;
  readonly readyPolicy: ReadyPolicy;
  readonly readyQueueLimit: number;
  readonly onCommandSent: (command: string, args: readonly unknown[]) => void;
};

export type InvocationLedger = {
  invoke(
    generateId: () => string,
    command: string,
    args: readonly unknown[],
    options: Required<Pick<IframeCallCallOptions, "timeoutMs">> &
      Pick<IframeCallCallOptions, "transfer">,
  ): Promise<unknown>;
  acceptReady(): void;
  settle(response: IframeCallResponse): string | undefined;
  terminate(
    buildError: (command: string) => SerializedIframeCallError,
  ): void;
};

/** queued와 pending invocation을 단일 lifecycle로 관리하는 host 내부 module을 만든다. */
export function createInvocationLedger(
  options: InvocationLedgerOptions,
): InvocationLedger {
  const queued = new Map<string, Invocation>();
  const pending = new Map<string, Invocation>();
  let ready = false;

  function clearDeadline(invocation: Invocation): void {
    if (invocation.timeoutId !== null) {
      clearTimeout(invocation.timeoutId);
    }
  }

  function rejectInvocation(
    invocation: Invocation,
    error: SerializedIframeCallError,
  ): void {
    clearDeadline(invocation);
    invocation.reject(error);
  }

  function expire(id: string, command: string, timeoutMs: number): void {
    const invocation = queued.get(id) ?? pending.get(id);
    if (invocation === undefined) return;

    queued.delete(id);
    pending.delete(id);
    rejectInvocation(
      invocation,
      createIframeCallError("timeout", "Command timed out.", {
        command,
        details: { timeoutMs },
      }),
    );
  }

  function post(id: string, invocation: Invocation): void {
    options.onCommandSent(invocation.command, invocation.args);
    pending.set(id, invocation);

    try {
      options.transport.post(
        createIframeCallRequest(id, invocation.command, invocation.args),
        options.targetOrigin,
        invocation.transfer,
      );
    } catch (error) {
      pending.delete(id);
      rejectInvocation(
        invocation,
        createIframeCallError("invalid_args", "Failed to post command request.", {
          command: invocation.command,
          details: error,
        }),
      );
    }
  }

  return {
    invoke(generateId, command, args, callOptions) {
      if (!ready && options.readyPolicy === "reject") {
        return Promise.reject(
          createIframeCallError("not_ready", "Iframe is not ready.", {
            command,
          }),
        );
      }

      return new Promise((resolve, reject) => {
        const id = generateId();
        const timeoutMs = callOptions.timeoutMs;
        const timeoutId =
          timeoutMs === 0 || timeoutMs === Number.POSITIVE_INFINITY
            ? null
            : setTimeout(() => expire(id, command, timeoutMs), timeoutMs);
        const invocation: Invocation = {
          command,
          args,
          transfer: callOptions.transfer,
          timeoutId,
          resolve,
          reject,
        };

        if (!ready) {
          if (queued.size >= options.readyQueueLimit) {
            clearDeadline(invocation);
            reject(
              createIframeCallError("queue_overflow", "Ready queue overflow.", {
                command,
                details: { readyQueueLimit: options.readyQueueLimit },
              }),
            );
            return;
          }

          queued.set(id, invocation);
          return;
        }

        post(id, invocation);
      });
    },
    acceptReady() {
      if (ready) return;
      ready = true;
      for (const [id, invocation] of queued) {
        // post가 동기 response를 유발해도 settle이 정확히 pending record를 찾게 한다.
        queued.delete(id);
        post(id, invocation);
      }
    },
    settle(response) {
      const invocation = pending.get(response.id);
      if (invocation === undefined) return undefined;

      pending.delete(response.id);
      clearDeadline(invocation);
      if (response.ok) {
        invocation.resolve(response.value);
      } else {
        invocation.reject(response.error);
      }
      return invocation.command;
    },
    terminate(buildError) {
      for (const [, invocation] of queued) {
        rejectInvocation(invocation, buildError(invocation.command));
      }
      queued.clear();
      for (const [, invocation] of pending) {
        rejectInvocation(invocation, buildError(invocation.command));
      }
      pending.clear();
    },
  };
}
