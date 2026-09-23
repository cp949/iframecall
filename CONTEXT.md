# iframecall

iframecall은 host와 iframe 사이에서 typed command 호출과 notification을 전달하는 통신 context다. 각 endpoint의 lifecycle은 호출 처리 가능 상태와 종료 상태를 결정한다.

## Language

**Invocation Ledger**:
Host endpoint에서 queued 및 pending command invocation의 상태 전이와 정리를 소유하는 내부 module이다. ready 도달, response, timeout, post failure, termination을 같은 invocation lifecycle로 취급한다.
_Avoid_: pending registry, ready queue

**Opaque Origin Mode**:
Host controller가 origin이 `"null"`인 sandboxed iframe과 통신하는 opt-in 모드다(`opaqueOrigin: true`). `"*"`로 송신하고, origin `"null"`과 expected source가 모두 일치하는 메시지만 수신한다. expected source가 없으면 controller를 만들지 않는다.
_Avoid_: wildcard mode, null origin mode

**Expected Source**:
Transport가 수신 메시지의 `event.source`와 비교하는 송신자 Window 참조다. host 기본 transport는 생성 시점의 iframe `contentWindow`를 쓴다. iframe 요소를 교체하면 달라지므로 controller를 다시 만든다.
_Avoid_: source window, peer window

**Ready Query**:
Host controller가 구독 직후 iframe에 보내는 `host:ready-query` notify다. 이미 ready를 보낸 runner는 `requested: true` ready로 다시 응답해, host 구독 전에 유실된 ready를 복구한다. 이전 버전 runner는 무시한다.
_Avoid_: ping, handshake retry
