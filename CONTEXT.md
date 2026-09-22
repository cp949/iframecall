# iframecall

iframecall은 host와 iframe 사이에서 typed command 호출과 notification을 전달하는 통신 context다. 각 endpoint의 lifecycle은 호출 처리 가능 상태와 종료 상태를 결정한다.

## Language

**Invocation Ledger**:
Host endpoint에서 queued 및 pending command invocation의 상태 전이와 정리를 소유하는 내부 module이다. ready 도달, response, timeout, post failure, termination을 같은 invocation lifecycle로 취급한다.
_Avoid_: pending registry, ready queue
