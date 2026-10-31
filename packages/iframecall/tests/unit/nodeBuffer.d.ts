/**
 * node:buffer의 Blob/File 최소 타입 선언.
 * 이 패키지는 @types/node를 의존성으로 두지 않아, 테스트가 쓰는 두 심볼만 DOM 타입으로 선언한다.
 * jsdom의 전역 Blob/File은 구조화 복제를 통과하지 못해 Node 구현체를 직접 가져와야 한다.
 */
declare module "node:buffer" {
  export const Blob: typeof globalThis.Blob;
  export const File: typeof globalThis.File;
}
