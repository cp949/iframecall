# 브라우저 지원 계약

이 문서는 `@cp949/iframecall`의 장기 브라우저 호환성 기준이다. 기준 시점은
Chrome 75가 stable로 승격된 **2019-06-04**이며, 지원 하한은 다음과 같다.

> **상태: 목표 계약.** 현재 배포 산출물이 아래 2개 브라우저 matrix를 실제로
> 충족하는지는 5절과 7절의 gate로 검증한다. 검증 전에는 이 버전들을 지원한다고
> 표시하거나 배포 설명에 사용하지 않는다.

> 이 목록은 Web Platform 전체의 완전한 금지 목록이 아니다. iframe RPC에 실제로
> 필요한 문법과 API, 그리고 회귀 위험이 큰 신기능만 관리하는 **curated 기준**이다.
> 새 문법이나 API를 도입할 때 이 문서에 없다는 이유만으로 허용된 것으로 간주하지
> 말고, 공식 호환 데이터와 실제 브라우저로 다시 검증한다.

## 1. 지원 대상

### 선정 규칙

- 기준일에 정식 배포된 Chrome과 Firefox의 최신 stable **엔진 세대**를 선택한다.
- 패치 버전은 기준일 확인 근거로 기록하되 지원 하한을 불필요하게 올리지 않는다.

| 대상            | 최소 지원 버전 | 기준일 근거                                                                                                                                                                                                                                                                   |
| --------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome Desktop  | **75**         | Google이 2019-06-04 Chrome `75.0.3770.80`을 Windows/macOS/Linux stable로 승격했다. [Chrome Releases](https://chromereleases.googleblog.com/2019/06/stable-channel-update-for-desktop.html)                                                                                    |
| Firefox Desktop | **67**         | Firefox 67은 2019-05-21 출시되었고 2019-06-03에도 current stable이었다. [Firefox 67 개발자 릴리스 노트](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/67), [Mozilla Roadmap 2019-06-03 기록](https://wiki.mozilla.org/Firefox/Roadmap/Updates#2019-06-03) |

빌드 도구에 전달할 논리적 target matrix는 다음과 같다. 패치 버전을 받지 않는 도구를
고려해 다음처럼 표현한다.

```text
chrome75, firefox67
```

Safari(macOS 포함), iOS Safari, legacy Edge, Android Chrome, Firefox for Android,
Samsung Internet, WebView, IE, Opera 및 브라우저 내장 WebView는 이 계약에 포함하지
않는다. 데스크톱 Chrome/Firefox 이외의 지원을 주장하려면 별도 target과 실제 실행
증거를 추가해야 한다.

## 2. 여기서 “지원”한다는 의미

위 브라우저 각각에서 배포된 ESM 산출물이 다음을 만족해야 지원으로 판정한다.

1. 구문 오류 없이 로드되고 공개 `host`/`iframe` 진입점을 import할 수 있다.
2. controller와 runner가 초기화되고 `ready` handshake를 완료한다.
3. command 성공/실패, notification, timeout, dispose가 동작한다.
4. 동일 origin 및 cross-origin iframe에서 `origin`과 `source` 검증이 유지된다.
5. 기본 request ID가 충돌 회피에 충분한 Web Crypto 난수로 생성된다.
6. 지원한다고 문서화한 transferable을 실제로 전달할 수 있다.

지원은 다음을 뜻하지 않는다.

- 해당 시점의 모든 브라우저, OS, WebView 또는 보조 기술 지원
- 소비자 애플리케이션과 그 의존성까지 포함한 자동 호환성 보장
- 모든 structured-clone 가능 타입 및 모든 transferable의 일괄 보장
- 정적 검사나 modern Chromium 단독 실행만으로 얻은 추정
- 보안 업데이트가 종료된 legacy 브라우저의 사용 권장

## 3. 소스 문법과 배포 산출물 문법

TypeScript 소스에는 빌드가 확실히 낮춰 주는 최신 문법을 사용할 수 있다. 브라우저가
실행하는 것은 소스가 아니라 `dist/*.js`이므로 호환성 판정 대상도 **배포 산출물**이다.
타입 구문은 제거되지만 JavaScript 내장 객체와 DOM API는 자동으로 생기지 않는다.

esbuild의 `target`은 지원하지 않는 **문법**을 가능한 범위에서 변환하지만, `Promise`와
같은 새 **API**에 polyfill을 주입하지 않는다. 변환할 수 없는 문법이면 빌드를 실패시킬
수도 있다. [esbuild Target 문서](https://esbuild.github.io/api/#target)

### 산출물에 남아도 되는 대표 문법

다음은 target matrix 전부가 지원하는 범위다. 그래도 새 사용 형태는 산출물 검사와
실제 브라우저 smoke를 통과해야 한다.

- `const`/`let`, 함수와 화살표 함수, class, template literal
- 기본 매개변수와 rest parameter
- destructuring과 object rest/spread. 각각 Chrome 49/Firefox 41 및 Chrome
  60/Firefox 55부터 지원된다. [MDN BCD destructuring](https://github.com/mdn/browser-compat-data/blob/main/javascript/operators/destructuring.json),
  [MDN BCD object initializer](https://github.com/mdn/browser-compat-data/blob/main/javascript/operators/object_initializer.json)
- `async`/`await`, 정적 ESM `import`/`export`
- `for...of`를 배열, `Set`, typed array처럼 검증된 iterable에 사용

### 산출물에 남기지 않는 대표 문법

아래 문법은 하나 이상의 최소 브라우저가 해석하지 못한다. 소스에서 사용하려면 빌드가
완전히 변환한다는 테스트가 있어야 하며, 그렇지 않으면 사용하지 않는다.

| 분류               | 예                                                    | 규칙과 근거                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| optional chaining  | `value?.name`                                         | 산출물 금지. Chrome 80, Firefox 74부터 지원한다. [MDN BCD 원본](https://github.com/mdn/browser-compat-data/blob/main/javascript/operators/optional_chaining.json)                                                |
| nullish coalescing | `value ?? fallback`                                   | 산출물 금지. Chrome 80, Firefox 72부터 지원한다. [MDN BCD 원본](https://github.com/mdn/browser-compat-data/blob/main/javascript/operators/nullish_coalescing.json)                                               |
| numeric separator  | `30_000`                                              | 산출물 금지. Chrome 75에서는 지원하지만 Firefox는 70부터 지원하므로 정수 literal로 변환해야 한다. [MDN BCD 문법 데이터](https://github.com/mdn/browser-compat-data/blob/main/javascript/grammar.json)            |
| 새 class 요소      | public/private field, private method, static block    | 산출물 금지. Firefox 67이 지원하지 않으므로 constructor와 prototype 기반 형태로 변환하거나 사용하지 않는다. [MDN BCD class 데이터](https://github.com/mdn/browser-compat-data/blob/main/javascript/classes.json) |
| 새 RegExp 문법     | lookbehind, named capture, Unicode property escape 등 | 산출물 금지. 예시 문법들은 Firefox 67이 지원하지 않으며 문법 오류는 polyfill로 복구할 수 없다. [MDN BCD RegExp 데이터](https://github.com/mdn/browser-compat-data/blob/main/javascript/regular_expressions.json) |

이 표는 완전 목록이 아니다. 동적 `import()`, async generator 등 새로운 실행 문법도
동일하게 “공식 데이터 확인 → target 변환 확인 → 산출물 검사” 순서를 거친다.

## 4. 런타임 및 DOM API 기준

### 바로 사용 가능

| 기능                                                                                                  | 판정 | 근거                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Window.postMessage`, `message` event                                                                 | 가능 | 기본 `postMessage`는 Chrome 2, Firefox 3부터 지원된다. [MDN BCD `Window`](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)                                                                                                                   |
| `HTMLIFrameElement.contentWindow`, `window.parent`                                                    | 가능 | iframe/Window 기반 통신은 두 최소 대상보다 오래된 API다. [MDN BCD `HTMLIFrameElement`](https://github.com/mdn/browser-compat-data/blob/main/api/HTMLIFrameElement.json), [MDN BCD `Window`](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json) |
| `Promise`                                                                                             | 가능 | Chrome 32, Firefox 29부터 지원된다. [MDN BCD `Promise`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Promise.json)                                                                                                                    |
| `Map`, `Set`                                                                                          | 가능 | Chrome 38, Firefox 13부터 지원된다. [MDN BCD `Map`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Map.json), [MDN BCD `Set`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Set.json)                        |
| `crypto.getRandomValues`, `Uint8Array`                                                                | 가능 | `getRandomValues`는 Chrome 11, Firefox 21부터 지원된다. [MDN BCD `Crypto`](https://github.com/mdn/browser-compat-data/blob/main/api/Crypto.json), [Web Cryptography 표준](https://www.w3.org/TR/WebCryptoAPI/#Crypto-method-getRandomValues)                      |
| `Reflect.ownKeys`                                                                                     | 가능 | Chrome 49, Firefox 42부터 지원된다. [MDN BCD `Reflect`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Reflect.json)                                                                                                                    |
| `String.prototype.startsWith`, `padStart`                                                             | 가능 | `startsWith`는 Chrome 41/Firefox 17, `padStart`는 Chrome 57/Firefox 48부터 지원된다. [MDN BCD `String`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/String.json)                                                                     |
| `Object.fromEntries()`                                                                                | 가능 | Chrome 73, Firefox 63부터 지원된다. [MDN BCD `Object`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Object.json)                                                                                                                      |
| `globalThis`                                                                                          | 가능 | Chrome 71, Firefox 65부터 지원된다. [MDN BCD globals](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/globals.json)                                                                                                                      |
| `Array.isArray`, `Object.getPrototypeOf`, `Object.getOwnPropertyDescriptor`, timer/event listener API | 가능 | 모두 matrix보다 오래된 API다. [MDN BCD JavaScript built-ins](https://github.com/mdn/browser-compat-data/tree/main/javascript/builtins), [MDN BCD Web API](https://github.com/mdn/browser-compat-data/tree/main/api)                                               |

### 조건부 사용

| 기능                        | 조건                                                                                                                           | 대안/검증                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postMessage` payload       | structured clone 가능한 데이터만 보낸다. 함수, symbol, DOM node 등 복제할 수 없는 값은 API 경계에서 허용하지 않는다.           | 단순 object/array/primitive를 기본 계약으로 삼고, 새 타입은 양쪽 실제 브라우저에서 왕복 테스트한다. [HTML structured data 표준](https://html.spec.whatwg.org/multipage/structured-data.html#structured-cloning)                                         |
| `postMessage` transfer list | concrete transferable 종류별로 matrix 전체 지원을 확인한다. 전송 후 원 소유자가 더 사용할 수 없다는 ownership 이전을 고려한다. | `ArrayBuffer`, `MessagePort` 등 타입별 테스트를 둔다. 지원을 확인하지 않은 transferable은 복사 가능한 payload로 대체한다. [HTML transferable objects 표준](https://html.spec.whatwg.org/multipage/structured-data.html#transferable-objects)            |
| `postMessage` 호출 형식     | 현재처럼 `message, targetOrigin, transfer` 위치 인자를 사용한다. options-object overload는 별도 검증 전 사용하지 않는다.       | 명시적 `targetOrigin`을 유지한다. [HTML cross-document messaging 표준](https://html.spec.whatwg.org/multipage/web-messaging.html#web-messaging)                                                                                                         |
| Web Crypto                  | request ID는 현재의 `getRandomValues(new Uint8Array(...))` 방식을 유지한다.                                                    | `crypto.randomUUID()`로 바꾸지 않는다. 테스트·특수 환경은 공개 `generateId` 주입점을 사용한다.                                                                                                                                                          |
| ESM 배포                    | 소비자 bundler가 패키지를 포함하거나, 브라우저가 올바른 JavaScript MIME/CORS 조건으로 module을 로드해야 한다.                  | 패키지는 ESM 전용이다. 소비자 앱의 번들 결과도 같은 target matrix로 검사한다.                                                                                                                                                                           |
| React hook 진입점           | 소비자가 선택한 React 버전과 React/프레임워크 산출물도 별도 호환되어야 한다.                                                   | 라이브러리 core 호환과 React host 앱 전체 호환을 각각 테스트한다. React 공식 문서는 브라우저 지원과 오래된 브라우저의 polyfill 필요 가능성을 별도로 설명한다. [React DOM browser support](https://react.dev/reference/react-dom/client#browser-support) |

### 직접 사용 금지

다음은 matrix 중 하나 이상이 기본 제공하지 않으므로, 검증된 polyfill/fallback과 테스트가 없는 한
라이브러리 실행 경로에서 사용하지 않는다.

| 금지 기능 예                            | 판정 근거                                                                                                                                                                                                                                                                                 | 대안                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `crypto.randomUUID()`                   | Chrome 92, Firefox 95부터 지원된다. [MDN BCD `Crypto`](https://github.com/mdn/browser-compat-data/blob/main/api/Crypto.json)                                                                                                                                                              | 현재의 `crypto.getRandomValues` 기반 ID 또는 `generateId` 주입             |
| 전역 `structuredClone()`                | Chrome 98, Firefox 94부터 지원된다. [MDN BCD `structuredClone`](https://github.com/mdn/browser-compat-data/blob/main/api/_globals/structuredClone.json)                                                                                                                                   | `postMessage` 자체의 structured clone을 사용하거나 명시적 직렬화 포맷 정의 |
| `Promise.allSettled()`, `Promise.any()` | 각각 Chrome 76/Firefox 71 및 Chrome 85/Firefox 79부터 지원된다. [MDN BCD `Promise`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/Promise.json)                                                                                                                | `Promise.all()`과 명시적 성공/실패 wrapping, 또는 검증된 polyfill          |
| `queueMicrotask()`                      | Chrome 71에서는 지원하지만 Firefox는 69부터 지원된다. [MDN BCD `queueMicrotask`](https://github.com/mdn/browser-compat-data/blob/main/api/_globals/queueMicrotask.json)                                                                                                                   | 필요한 의미를 확인한 뒤 `Promise.resolve().then(...)` 사용                 |
| `AbortSignal.timeout()`                 | 두 최소 버전보다 뒤에 추가되었다. [MDN BCD `AbortSignal`](https://github.com/mdn/browser-compat-data/blob/main/api/AbortSignal.json)                                                                                                                                                      | `setTimeout`과 명시적 정리 로직                                            |
| `BigInt`                                | Chrome 67에서는 지원하지만 Firefox는 68부터 지원된다. [MDN BCD `BigInt`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/BigInt.json)                                                                                                                            | 안전한 범위의 `number`, 문자열 또는 명시적 직렬화 포맷                     |
| `WeakRef`, `FinalizationRegistry`       | 각각 Chrome 84, Firefox 79부터 지원된다. [MDN BCD `WeakRef`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/WeakRef.json), [MDN BCD `FinalizationRegistry`](https://github.com/mdn/browser-compat-data/blob/main/javascript/builtins/FinalizationRegistry.json) | 명시적 소유권과 `dispose` 기반 수명 관리                                   |

위 기능들의 도입 버전은 각 내장 객체 및 Web API별 기계 판독 가능한 `version_added`를
제공하는 [MDN Browser Compatibility Data](https://github.com/mdn/browser-compat-data)로
판정한다. BCD의 지원 데이터 의미는 [compat data schema](https://github.com/mdn/browser-compat-data/blob/main/schemas/compat-data-schema.md)를 따른다.

라이브러리는 runtime polyfill을 번들하지 않는다. polyfill을 소비자에게 요구하는 변경은
단순 구현 세부가 아니라 공개 지원 계약 변경으로 취급해 문서, peer 요구사항 및 실제
브라우저 테스트를 함께 갱신한다.

## 5. 현재 소스 감사

감사 대상은 `packages/iframecall/src`와 현재 생성된 `packages/iframecall/dist`이다.

| 현재 사용                                                                                       | 위치                                                                                                                       | API 판정               | 산출물 판정                                             |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------- |
| `postMessage`, `message` listener, `event.data/origin/source`, `contentWindow`, `window.parent` | [`core/transport.ts`](packages/iframecall/src/core/transport.ts)                                                           | 가능                   | positional `postMessage`와 source/origin 검증 유지 필요 |
| `Promise`, `Map`, `Set`, timer                                                                  | `host/*`, `iframe/runner.ts`                                                                                               | 가능                   | polyfill 없이 matrix에 존재                             |
| `crypto.getRandomValues`, `Uint8Array`, `padStart`                                              | [`host/controller.ts`](packages/iframecall/src/host/controller.ts)                                                         | 가능                   | `crypto.randomUUID`보다 낮은 기준에 맞음                |
| `Reflect.ownKeys`, prototype/descriptor 조회, `startsWith`, `bind`                              | [`iframe/runner.ts`](packages/iframecall/src/iframe/runner.ts)                                                             | 가능                   | matrix에 존재                                           |
| `Array.isArray`, `Error`, object property 검사                                                  | `core/messages.ts`, `core/errors.ts`                                                                                       | 가능                   | matrix에 존재                                           |
| transferable generic                                                                            | [`core/types.ts`](packages/iframecall/src/core/types.ts), [`core/transport.ts`](packages/iframecall/src/core/transport.ts) | 조건부                 | 실제 transferable 종류별 증거가 아직 없음               |
| object rest/spread, destructuring                                                               | 소스 전반                                                                                                                  | 가능                   | 두 최소 대상에서 해석 가능                              |
| optional chaining, nullish coalescing, numeric separator                                        | 소스 전반                                                                                                                  | 소스에서는 조건부 가능 | build가 완전히 변환해야 함                              |
| React hooks와 `react/jsx-runtime`                                                               | `host/useIframeCallController.tsx`, `iframe/useIframeCallRunner.tsx`                                                       | 외부 경계              | React 및 소비자 번들을 별도 검증해야 함                 |

### 현재 확인된 격차

- [`package.json`](packages/iframecall/package.json)의 Browserslist와
  [`tsup.config.ts`](packages/iframecall/tsup.config.ts)의 실제 build target은
  `chrome75`, `firefox67`로 이 문서의 matrix와 일치한다.
- target 설정의 일치는 지원 완료 증거가 아니다. clean build 후 새로 생성된 모든
  `dist` 파일에서 금지 문법이 제거됐는지 확인하고, Chrome 75와 Firefox 67 실제
  브라우저 gate를 각각 통과해야 한다.
- object rest/spread와 destructuring은 두 최소 대상이 직접 지원하므로 산출물에 남아도
  된다. optional chaining, nullish coalescing, numeric separator는 build가 완전히
  변환해야 한다.

```sh
cd packages/iframecall
pnpm exec esbuild \
  src/host/index.ts \
  src/iframe/index.ts \
  --bundle --format=esm --splitting \
  --outdir=/tmp/iframecall-browser-support-audit \
  --target=chrome75,firefox67 \
  --external:react
```

위 명령의 성공 여부와 생성된 파일 검사는 7절의 target build gate에 기록한다. esbuild
target은 런타임 API를 polyfill하지 않으므로 성공하더라도 실제 브라우저 gate가 별도로
필요하다. [esbuild Target 문서](https://esbuild.github.io/api/#target)

## 6. 의존성 경계

| 소유자                       | 책임                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `@cp949/iframecall`          | 자체 `dist`의 parse/runtime 호환성, core RPC, 제공하는 React hook 코드             |
| `react`, `react/jsx-runtime` | peer package 자체의 브라우저 호환성 및 런타임 요구사항                             |
| 소비자 bundler/framework     | dependency transpilation, chunk/module loading, polyfill, CORS/MIME, minifier 결과 |
| 소비자 애플리케이션          | command 구현, payload/transferable 타입, 사용한 Web API와 UI/CSS                   |

`react`와 `@types/react`는 peer dependency이므로 이 패키지가 React 실행 코드를
재번들하거나 낮은 target으로 변환하지 않는다. 따라서 “iframecall core가 지원됨”과
“특정 React/Next.js 애플리케이션 전체가 지원됨”은 별도 주장이다. 양쪽 페이지가 서로
다른 framework/build를 쓰면 host와 iframe 각각의 최종 산출물을 검사한다.

## 7. 검증 절차와 증명 범위

지원 선언이나 배포 전에 아래 gate를 순서대로 수행한다.

### 7.1 정적 계약 검사

1. target matrix가 package metadata와 실제 build config에 동일하게 반영되었는지 확인한다.
2. `dist/*.js`에서 금지 문법(`?.`, `??`, numeric separator 등)을
   AST parser 또는 target-aware 검사기로 탐지한다.
3. `dist/*.js`의 전역/내장/DOM API 목록을 추출해 이 문서와 BCD에 대조한다.
4. 의존 chunk와 각 export condition에서 실제 선택되는 파일을 모두 검사한다.

한계: 문자열 검색은 주석/문자열 오탐과 문법 변형 누락이 있으므로 단독 gate로 쓰지
않는다. 정적 검사는 API가 실제 브라우저에서 올바르게 동작하거나 payload가 clone된다는
것도 증명하지 못한다.

### 7.2 target build

1. clean 상태에서 정확한 matrix로 ESM을 빌드한다.
2. 지원 대상별 parser/transform 결과를 확인한다.
3. package tarball을 만들고 깨끗한 consumer fixture에서 두 진입점을 import한다.

한계: 빌드 성공은 runtime API 존재, DOM 보안 동작, React peer 및 실제 브라우저 실행을
증명하지 않는다.

### 7.3 실제 브라우저 자동 smoke

각 최소 버전에서 다음을 실행한다.

- same-origin 및 cross-origin ready handshake
- 성공값, async 성공값, 직렬화된 오류의 request/response 왕복
- notification 양방향 처리
- timeout, duplicate ready, dispose/terminated 처리
- 잘못된 origin 및 다른 `event.source` 거부
- 기본 request ID 생성과 다중 in-flight 응답 매칭
- 지원한다고 선언한 transferable별 왕복 및 ownership 이전

한계: 최신 Playwright/Chromium 및 최신 Firefox 결과는 Chrome 75와 Firefox 67의
대체 증거가 아니다. 최소 버전의 실제 바이너리 또는 신뢰할 수 있는 해당 버전 원격
브라우저가 필요하다.

### 7.4 수동 확인

- Chrome 75와 Firefox 67의 iframe navigation 및 콘솔 오류
- 두 브라우저의 cross-origin `MessageEvent.source`와 transfer 동작
- 페이지 unload/navigation 중 dispose와 in-flight request 정리

수동 확인은 자동 테스트가 포착하기 어려운 OS/브라우저/iframe lifecycle 차이를 보완하지만,
반복 가능한 자동 회귀 gate를 대체하지 않는다.

## 8. 유지보수 규칙

- 새 문법/API/transferable을 추가하는 변경은 공식 BCD 또는 표준 링크와 판정을 이
  문서에 함께 추가한다.
- 최소 버전을 올리는 것은 breaking support-policy 변경으로 취급하고 changelog에 남긴다.
- bundler, transpiler, minifier 또는 React major를 바꾸면 전체 matrix를 다시 검증한다.
- “build 성공”, “typecheck 성공”, “최신 브라우저 성공”을 최소 버전 지원 완료로 표현하지
  않는다.
- 지원표의 사실과 현재 코드 상태가 다르면 코드 상태를 숨기지 않고 이 문서의 “현재
  확인된 격차”에 기록한다.
