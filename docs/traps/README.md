# 함정 기록

iframecall 작업 중 실제로 부딪힌 함정. 파일 하나에 함정 하나. 파일명은 `TRP-<4자리 번호>-<제목>.md`, 번호는 발견 순서.

| 파일                                                                                                               | 요약                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| [TRP-0001-hook-ignores-iframe-element-swap.md](TRP-0001-hook-ignores-iframe-element-swap.md)                       | `useIframeCallController`는 iframe 요소 교체를 감지하지 않음                                                                         |
| [TRP-0002-contentwindow-identity-survives-navigation.md](TRP-0002-contentwindow-identity-survives-navigation.md)   | src 변경은 `contentWindow` identity를 바꾸지 않음. 바뀌는 건 요소 교체뿐                                                             |
| [TRP-0003-next-dev-blocks-opaque-iframe.md](TRP-0003-next-dev-blocks-opaque-iframe.md)                             | Next.js dev server가 origin `"null"` 문서의 `/_next` 리소스를 차단                                                                   |
| [TRP-0004-ready-lost-before-host-subscribe.md](TRP-0004-ready-lost-before-host-subscribe.md)                       | iframe이 host 구독 전에 ready를 보내면 유실되고 controller가 영구 `pending`                                                          |
| [TRP-0005-sandbox-self-navigation-passes-source-check.md](TRP-0005-sandbox-self-navigation-passes-source-check.md) | sandboxed iframe이 자기 자신을 다른 문서로 이동시켜도 origin·source 검사를 통과. source 검사는 요소를 인증할 뿐 문서를 인증하지 않음 |
