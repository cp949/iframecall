/**
 * 실제 구조화 복제(structured clone)와 transfer 의미를 가진 transport 더블.
 * testTransport.ts의 in-memory transport는 객체를 그대로 넘기므로 File/Blob/ArrayBuffer 전달을 검증하지 못한다.
 * 여기서는 MessageChannel을 사용해 postMessage와 같은 복제 알고리즘을 거치게 한다.
 * 한계: 브라우저 엔진이 아니라 Node(v8) 구현이므로 cross-origin 직렬화 경로와 jsdom Blob은 검증하지 않는다.
 */

import type {
  IframeCallTransferable,
  IframeCallTransport,
} from "../../src/host/index.ts";

type PortTransport = IframeCallTransport & {
  /** 포트를 닫아 테스트 종료 후 이벤트 루프가 남지 않게 한다. */
  close(): void;
};

/**
 * host와 iframe을 MessageChannel의 두 포트로 연결한다.
 * 메시지는 비동기로 도착하며, post의 transfer 인자는 MessagePort.postMessage로 그대로 전달된다.
 */
export function createMessageChannelTransports(options?: {
  readonly hostOrigin?: string;
  readonly iframeOrigin?: string;
}) {
  const hostOrigin = options?.hostOrigin ?? "https://host.example.com";
  const iframeOrigin = options?.iframeOrigin ?? "https://editor.example.com";
  const hostSource = { name: "host" };
  const iframeSource = { name: "iframe" };
  const channel = new MessageChannel();

  const host = createPortTransport(channel.port1, iframeOrigin, iframeSource);
  const iframe = createPortTransport(channel.port2, hostOrigin, hostSource);

  return {
    host,
    iframe,
    close() {
      host.close();
      iframe.close();
    },
  };
}

/**
 * 한 포트를 transport로 감싼다.
 * 수신 이벤트의 origin/source는 상대편 값으로 채워 controller와 runner의 검증을 통과시킨다.
 */
function createPortTransport(
  port: MessagePort,
  peerOrigin: string,
  peerSource: object,
): PortTransport {
  return {
    expectedSource: peerSource,
    post(
      message: unknown,
      targetOrigin: string,
      transfer?: readonly IframeCallTransferable[],
    ) {
      // 브라우저처럼 targetOrigin이 맞지 않으면 전달하지 않는다.
      if (targetOrigin !== "*" && targetOrigin !== peerOrigin) {
        return;
      }

      port.postMessage(message, { transfer: transfer as Transferable[] });
    },
    subscribe(handler) {
      const listener = (event: MessageEvent) => {
        handler({ data: event.data, origin: peerOrigin, source: peerSource });
      };

      port.addEventListener("message", listener as EventListener);
      // addEventListener로 구독하면 포트가 자동 시작되지 않는다.
      port.start();

      return () => {
        port.removeEventListener("message", listener as EventListener);
      };
    },
    close() {
      port.close();
    },
  };
}
