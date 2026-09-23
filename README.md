# iframecall

`@cp949/iframecall` 라이브러리와 데모 앱을 함께 관리하는 Turborepo 모노레포.

- 라이브러리 본체: [packages/iframecall](./packages/iframecall) — npm 배포 대상
- 데모 앱: React 18/19 각각의 host/iframe 쌍 (총 4개)

## 워크스페이스 구조

```text
iframecall/
├── packages/
│   ├── eslint-config/      # 공유 ESLint 설정
│   ├── iframecall/         # @cp949/iframecall (라이브러리)
│   └── typescript-config/  # 공유 TypeScript 설정
└── apps/
    ├── host-r19/           # React 19 host 데모 (포트 3300)
    ├── iframe-r19/         # React 19 iframe 데모 (포트 3301)
    ├── host-r18/           # React 18 host 데모 (포트 3302)
    └── iframe-r18/         # React 18 iframe 데모 (포트 3303)
```

## 사용법

라이브러리 사용법과 API는 [packages/iframecall/README.md](./packages/iframecall/README.md)를 참고한다.

## 개발

요구 사항: Node.js `>=22.13.0`, pnpm `11.27.1`.

```sh
# 의존성 설치
pnpm install

# 라이브러리 빌드
pnpm build

# React 19 데모 한 쌍 실행 (host:3300, iframe:3301)
pnpm dev:r19

# React 18 데모 한 쌍 실행 (host:3302, iframe:3303)
pnpm dev:r18

# 전체 검증 (lint, build, typecheck, test)
pnpm verify

# 포맷팅
pnpm format
```

## 배포

npm 배포는 루트에서 `pnpm release-it`으로 진행한다([release-it](https://github.com/release-it/release-it)). `packages/iframecall`의 버전 bump, CHANGELOG 정리, npm publish, 커밋·태그·push를 수행한다. 절차는 [RELEASING.md](./RELEASING.md)를 따른다.

> 실제 npm 배포와 `origin`으로의 push는 외부 쓰기 작업이다.

## 라이선스

MIT
