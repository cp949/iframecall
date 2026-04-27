// host와 iframe 양쪽이 동일한 인터페이스로 메시지를 주고받도록 postMessage 어댑터를 정의한다.
// transport는 Window를 직접 노출하지 않아 controller/runner가 보안 검증(origin, source)에만 집중하도록 만든다.
// 테스트에서는 Window 대신 사용할 수 있는 mock transport를 같은 인터페이스로 주입한다.

import type { IframeCallTransferable } from "./types.ts";

/** transport가 controller/runner로 전달하는 정규화된 수신 이벤트. */
export type IframeCallTransportEvent = {
  /** postMessage로 도착한 raw payload. 파싱 전 단계의 값이다. */
  readonly data: unknown;

  /** 메시지 송신자의 origin. allowedOrigins 검증에 사용한다. */
  readonly origin: string;

  /** 송신자 Window 참조. expectedSource와 비교해 cross-frame 위장을 차단한다. */
  readonly source: unknown;
};

/** controller/runner가 사용하는 transport 추상화. Window 외 다른 매체로도 교체할 수 있다. */
export type IframeCallTransport = {
  /** 송신자 Window의 기대값. 정의되어 있으면 수신 시 source 일치를 강제한다. */
  expectedSource?: unknown;

  /** 메시지를 targetOrigin으로 전송한다. transferable이 있으면 ownership을 함께 넘긴다. */
  post(
    message: unknown,
    targetOrigin: string,
    transfer?: readonly IframeCallTransferable[],
  ): void;

  /** 수신 이벤트를 구독한다. 반환된 함수를 호출하면 listener를 해제한다. */
  subscribe(handler: (event: IframeCallTransportEvent) => void): () => void;
};

/**
 * host 측에서 사용하는 transport. 자식 iframe의 contentWindow로 postMessage를 보낸다.
 * `expectedSource`는 contentWindow가 swap되기 전 시점에 캐시되므로,
 * iframe src 변경처럼 contentWindow가 교체되는 경우 transport도 다시 만들어야 한다.
 */
export function createIframeWindowTransport(
  iframe: HTMLIFrameElement,
): IframeCallTransport {
  return {
    expectedSource: iframe.contentWindow ?? undefined,
    post(message, targetOrigin, transfer) {
      iframe.contentWindow?.postMessage(
        message,
        targetOrigin,
        transfer as Transferable[] | undefined,
      );
    },
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        handler({
          data: event.data,
          origin: event.origin,
          source: event.source,
        });
      };

      window.addEventListener("message", listener);

      return () => {
        window.removeEventListener("message", listener);
      };
    },
  };
}

/**
 * iframe 측에서 사용하는 transport. 부모 Window를 송신 대상으로 삼고,
 * 수신 이벤트의 source가 부모 Window 참조와 일치하는지 검증한다.
 */
export function createParentWindowTransport(): IframeCallTransport {
  return {
    expectedSource: window.parent,
    post(message, targetOrigin, transfer) {
      window.parent.postMessage(
        message,
        targetOrigin,
        transfer as Transferable[] | undefined,
      );
    },
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        handler({
          data: event.data,
          origin: event.origin,
          source: event.source,
        });
      };

      window.addEventListener("message", listener);

      return () => {
        window.removeEventListener("message", listener);
      };
    },
  };
}
