# Changelog

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따르며, 버전 관리는 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 준수합니다. 0.x 버전대에서는 호환성이 깨지는 변경도 minor 버전 증가로 처리합니다.

## [Unreleased]

### Added

- host controller의 정식 command 실행 API로 `invoke(command, args, options?)`를 추가했습니다.

### Deprecated

- `controller.call()`은 호환성을 위해 유지하지만 다음 major release에서 제거할 예정입니다. `controller.invoke()`를 사용하세요.

## [0.2.0] - 2026-04-28

### Added

- `$` 네임스페이스와 `$onCommandRun` wrap hook 도입 — 명령 실행 전후를 감싸는 미들웨어 형태의 훅을 등록할 수 있습니다.

### Changed

- 라이프사이클/도메인 채널의 책임을 분리하고, 라이프사이클 ready 알림 API를 `sendLifecycleReady`로 정리했습니다. **(Breaking)**

### BREAKING CHANGES

- 라이프사이클 ready 전송 API의 식별자가 `sendLifecycleReady`로 리네임되었습니다. 이전 명칭을 직접 호출하던 코드는 새 이름으로 갱신해야 합니다.

## [0.1.0] - 2026-04-27

### Added

- `@cp949/iframecall` 최초 공개 — 타입 안전한 host ↔ iframe postMessage 호출 라이브러리.
- React 18/19 호환 진입점(`./host`, `./iframe`) 제공.
