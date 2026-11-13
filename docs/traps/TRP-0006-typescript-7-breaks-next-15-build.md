# TypeScript 7로 올리면 React 18 데모 앱(Next.js 15)의 `next build`가 실패한다

발견: 2026-11-13, `typescript` 6.0.3 → 7.0.2 업그레이드를 시도했을 때.

## 증상

`host-r18`, `iframe-r18`의 `next build`가 type 검사 단계에서 실패한다.

```
Failed to compile.
TypeScript 7.0.2 is not supported by this version of Next.js. The TypeScript 7 native compiler does not provide the JavaScript compiler API that Next.js requires. Install TypeScript 6 (e.g. npm install --save-dev typescript@^6) or upgrade to a Next.js v16.2.11 or later to get support for TypeScript 7.
```

## 원인

사실:

- r18 앱은 `next` 15.5.28을 쓴다. 이 버전은 TypeScript 7의 네이티브 컴파일러를 지원하지 않는다.
- 오류 메시지가 지원 기준으로 Next.js 16.2.11 이상을 안내한다.

## 확인 범위

- `typescript` 7.0.2와 r18 앱 2개만 6.0.3으로 둔 구성에서 `pnpm verify`(lint, build, check-types, test)가 통과했다. 루트, `packages/iframecall`, r19 앱 2개(`next` 16.4.6)는 7.0.2였다.
- r18 앱을 `next` 16으로 올리는 방법은 시도하지 않았다. r18 앱은 React 18 호환 검증용이라 `next` 버전 변경이 목적에 맞는지 먼저 정해야 한다.

## 결정

`typescript`는 모든 `package.json`에서 `6.0.3`으로 고정한다. 지정자는 `^` 없이 정확한 버전이다.

`pnpm outdated -r`에 `typescript 7.x`가 계속 보이지만 올리지 않는다.

## 재시도 조건

아래 둘 중 하나가 정해진 뒤에만 7로 올린다.

1. r18 앱의 `next`를 16.2.11 이상으로 올리기로 결정한다.
2. r18 앱만 `typescript` 6.0.3으로 고정하고 나머지를 7로 올리기로 결정한다. 이 구성은 위 확인 범위에서 통과했다.
