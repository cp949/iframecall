# iframecall

`@cp949/iframecall` 라이브러리와 데모 앱을 함께 관리하는 Turborepo 모노레포.

- 라이브러리 본체: [packages/iframecall](./packages/iframecall) — npm 배포 대상
- 데모 앱: React 18/19 각각의 host/iframe 쌍 (총 4개)

## 워크스페이스 구조

```text
iframecall/
├── packages/
│   ├── iframecall/         # @cp949/iframecall (라이브러리)
│   └── typescript-config/  # 공유 TS 설정
└── apps/
    ├── host-r19/           # React 19 host 데모 (포트 3300)
    ├── iframe-r19/         # React 19 iframe 데모 (포트 3301)
    ├── host-r18/           # React 18 host 데모 (포트 3302)
    └── iframe-r18/         # React 18 iframe 데모 (포트 3303)
```

## 사용법

라이브러리 사용법과 API는 [packages/iframecall/README.md](./packages/iframecall/README.md)를 참고한다.

## 개발

요구 사항: Node.js 18+, pnpm 9.

```sh
# 의존성 설치
pnpm install

# 라이브러리 빌드
pnpm build

# React 19 데모 한 쌍 실행 (host:3300, iframe:3301)
pnpm dev:r19

# React 18 데모 한 쌍 실행 (host:3302, iframe:3303)
pnpm dev:r18

# 검증
pnpm test
pnpm check-types
pnpm lint
pnpm format
```

## 라이선스

MIT
