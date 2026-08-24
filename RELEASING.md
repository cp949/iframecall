# @cp949/iframecall 배포

이 문서는 `@cp949/iframecall`을 npm에 배포하는 유지보수자용 절차다.

위험도: 높음

롤백: npm에 배포된 동일 버전은 덮어쓰지 않는다. 문제가 있으면 다음 patch 버전으로 교정한다. 원격 태그 삭제는 가능하지만 별도의 위험 작업이다.

## 전제 조건

- 루트에서 Node.js `^20.19.0 || >=22.13.0`과 pnpm `10.34.5`를 사용한다.
- npm registry, 로그인, `@cp949` scope 배포 권한을 확인한다.
- `packages/iframecall/package.json`의 `version`이 배포할 버전인지 확인한다.
- 버전 변경과 배포 대상 코드를 커밋하고 작업 트리를 깨끗하게 유지한다.
- 태그를 push할 경우 `origin`과 push 권한을 확인한다.

```sh
npm config get registry
npm whoami
git status --short
```

## 대화형 배포

1. 필요하면 실제 배포 전에 전체 검증을 먼저 실행해 문제를 확인한다.

   ```sh
   pnpm verify:release
   ```

2. 배포 도구를 실행한다.

   ```sh
   pnpm publish:npm
   ```

3. `2) dry-run 배포`로 강제 전체 검증, 패키지 산출물과 `prepublishOnly` 빌드를 확인한다.
4. `3) 배포`로 강제 전체 검증을 다시 통과한 뒤 npm에 실제 배포한다.
5. registry 반영 후 `4) registry 상태 새로고침`과 `5) 배포 결과 확인`으로 버전과 `peerDependencies`를 확인한다.
6. 배포를 확인한 뒤에만 `6) 버전 태그 붙여서 푸시`를 선택한다.

대화형 도구의 각 메뉴는 독립적으로 실행된다.

- dry-run과 실제 배포는 기존 Turbo cache를 읽지 않는 `pnpm verify:release`를 먼저 실행하며, 실패하면 배포를 중단한다.
- 메뉴 1번의 전체 검증과 메뉴 `b`의 빌드만 실행도 각각 `pnpm verify:release`, `pnpm build:release`로 Turbo cache를 무시한다.
- dirty working tree와 누락된 산출물은 메뉴에서 경고하지만 실제 배포를 자동 차단하지 않는다.
- 실제 배포는 해당 버전이 registry에 없다고 확인된 경우에만 진행된다. registry 조회가 실패하면 중단한다.
- 메뉴 6번은 `v<version>` annotated tag를 현재 `HEAD`에 만들고 즉시 `git push origin v<version>`을 실행한다.
- 태그 push는 작업 트리가 깨끗하지 않거나 같은 태그가 다른 커밋을 가리키면 중단한다. npm 배포 여부는 자동 확인하지 않는다.

## 비대화형 실행

터미널 TTY가 없는 환경에서는 동작 인자가 필요하다.

```sh
# dry-run
node scripts/publish-packages.mjs --dry-run

# 실제 배포
node scripts/publish-packages.mjs --publish
```

비대화형 dry-run과 실제 배포도 `pnpm verify:release`를 자동 실행하며, 실패하면 배포를 중단한다.

`pnpm verify:release`와 `pnpm build:release`의 Turbo `--force`는 기존 local/remote cache를 읽지 않고 작업을 다시 실행한 뒤 결과를 새 cache에 기록한다. 일반 개발용 `pnpm verify`와 `pnpm build`는 cache를 계속 사용한다.

## 실패 후 조치

- npm 배포 명령이 실패하고 registry에 해당 버전이 없으면 같은 버전으로 재시도한다.
- registry에 해당 버전이 존재하면 제거하거나 덮어쓰지 말고 다음 patch 버전으로 교정한다.
- registry 반영이 지연되면 메뉴 4번으로 상태를 새로고침한 뒤 메뉴 5번으로 다시 확인한다.
- 태그는 만들어졌지만 push가 실패했다면 출력된 `git push origin v<version>` 명령으로 재시도한다.
