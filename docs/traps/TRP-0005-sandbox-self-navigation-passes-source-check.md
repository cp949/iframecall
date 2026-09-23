# sandboxed iframe의 자기 navigation은 origin·source 검사를 통과한다

발견: 2026-09-23. runo-lab 세션이 보안 근거 재검토를 요청했고, headless Chromium으로 확인.

## 잘못된 전제

처음 문서: "`"*"` 송신 중 iframe이 모르는 문서로 navigation하면 그 문서가 command를 받는다. src는 host가 통제하므로 수용한다."

이 전제는 iframe 안에서 신뢰하지 않는 코드가 돌면 성립하지 않는다. iframe 안의 코드가 스스로 문서를 이동시킬 수 있다.

## 사실 (headless Chromium 실측)

구성: host `127.0.0.1:8791`, iframe `sandbox="allow-scripts"` src=`127.0.0.1:8792/first.html`. first.html이 300ms 뒤 `location.href = "http://127.0.0.1:8793/attacker.html"`.

결과:

```json
{ "data": "first",                       "origin": "null", "sameSource": true }
{ "data": "attacker:null",               "origin": "null", "sameSource": true }
{ "data": "attacker-got:second-command", "origin": "null", "sameSource": true }
```

- `sandbox="allow-scripts"`는 iframe의 자기 navigation을 막지 않는다. 다른 origin으로도 이동한다.
- 이동한 문서도 sandbox flag를 이어받아 `self.origin === "null"`이다.
- `event.source`는 이동 전에 캡처한 `contentWindow`와 `===`로 같다.
- host가 `"*"`로 보낸 메시지를 이동한 문서가 받는다.
- 결론: opaque 모드의 source 검사는 iframe 요소를 인증할 뿐 문서를 인증하지 않는다.

## 함의

- iframe 안에 신뢰하지 않는 코드가 없을 때만 "src는 host 통제" 근거가 성립한다.
- 신뢰하지 않는 코드가 있으면(예: runo-lab 범주 B 사용자 코드):
  - 채널 전체를 신뢰하지 않는 상대로 취급한다. command 인자에 비밀·토큰 금지, 응답·notify 검증.
  - iframe 안의 코드는 navigation 없이도 이미 채널을 제어한다. navigation은 그 제어를 iframe 밖의 문서로 넘기는 경로를 더한다.

가설(미검증):

- iframe 문서에 CSP로 네트워크를 막아도, 이동한 문서에는 공격자 문서의 CSP가 적용되어 제한을 벗어난다.
- 설계 후보 B(MessageChannel port)는 이동한 새 문서가 port를 갖지 않으므로 이 경로를 닫는다. 이동 전 문서의 코드가 port를 제어하는 문제는 남는다.

## 조치

- 라이브러리 README 보안 근거 문구를 수정했다(수용 조건 한정, 신뢰하지 않는 코드 실행 시 취급 규칙). 커밋 `cbbba52`.
- 코드 변경 없음.
