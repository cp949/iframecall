/**
 * controller와 runner 단위 테스트가 사용하는 in-memory transport 더블.
 * 메시지 라우팅, ready/dispose lifecycle, error scenario 등을 외부 환경 없이 재현한다.
 * targetOrigin과 source 매칭 동작도 함께 포함해 브라우저 postMessage 의미를 그대로 모사한다.
 */

import type {
  IframeCallTransferable,
  IframeCallTransport,
  IframeCallTransportEvent,
} from "../../src/host/index.ts";

/**
 * controller와 runner를 같은 process 안에서 연결한다.
 * 브라우저 DOM 없이 postMessage 흐름과 source/origin 검증을 테스트할 때 사용한다.
 */
export function createLinkedTransports() {
  const hostSource = { name: "host" };
  const iframeSource = { name: "iframe" };
  const host = createMemoryTransport("https://host.example.com", hostSource);
  const iframe = createMemoryTransport(
    "https://editor.example.com",
    iframeSource,
  );

  host.connectTo(iframe, iframeSource);
  iframe.connectTo(host, hostSource);

  return {
    host,
    iframe,
    hostSource,
    iframeSource,
  };
}

type MemoryTransport = IframeCallTransport & {
  readonly origin: string;
  getListenerCount(): number;
  getPosts(): readonly MemoryTransportPost[];
  connectTo(nextPeer: MemoryTransport, nextPeerSource: object): void;
  emit(event: IframeCallTransportEvent): void;
  failNextPost(error: unknown): void;
};

/** 테스트가 transport 경계에서 실제 post 인자를 관측할 때 쓰는 기록 항목. */
type MemoryTransportPost = {
  readonly message: unknown;
  readonly targetOrigin: string;
  readonly transfer: readonly IframeCallTransferable[] | undefined;
};

/**
 * 상대 transport로 message event를 동기 전달하는 테스트 더블을 만든다.
 * targetOrigin이 상대 origin과 맞지 않으면 브라우저처럼 message를 전달하지 않는다.
 */
function createMemoryTransport(
  origin: string,
  source: object,
): MemoryTransport {
  const listeners = new Set<(event: IframeCallTransportEvent) => void>();
  const posts: MemoryTransportPost[] = [];
  let peer: MemoryTransport | null = null;
  let nextPostError: unknown = null;

  const transport: MemoryTransport = {
    origin,
    post(
      message: unknown,
      targetOrigin: string,
      transfer?: readonly IframeCallTransferable[],
    ) {
      posts.push({ message, targetOrigin, transfer });

      if (nextPostError !== null) {
        const error = nextPostError;
        nextPostError = null;
        throw error;
      }

      if (peer === null) {
        return;
      }

      if (targetOrigin !== peer.origin) {
        return;
      }

      peer.emit({
        data: message,
        origin,
        source,
      });
    },
    subscribe(handler) {
      listeners.add(handler);

      return () => {
        listeners.delete(handler);
      };
    },
    getListenerCount() {
      return listeners.size;
    },
    getPosts() {
      return posts;
    },
    connectTo(nextPeer, nextPeerSource) {
      peer = nextPeer;
      transport.expectedSource = nextPeerSource;
    },
    emit(event: IframeCallTransportEvent) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    failNextPost(error) {
      nextPostError = error;
    },
  };

  return transport;
}
