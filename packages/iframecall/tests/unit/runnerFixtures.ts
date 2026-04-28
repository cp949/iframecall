/**
 * iframe-side runner 테스트가 공유하는 command 타입과 class fixture를 제공한다.
 * Commands class API와 helper/debug 흐름에서 같은 fixture를 재사용해 dispatch 노출 규칙을 검증한다.
 */
import type { IframeHelper } from "../../src/core/types.ts";

export type TestCommands = {
  sum: (a: number, b: number) => Promise<number>;
  fail: () => Promise<void>;
};

export type DeviceCommands = {
  ping(): Promise<"pong">;
  echo(value: string): Promise<string>;
  readState(): Promise<string>;
  fail(): Promise<void>;
};

export type DeviceNotificationsToHost = {
  stateChanged: { isLoading: boolean };
};

/**
 * runner lifecycle 테스트에서 반복되는 기본 Commands class를 만든다.
 * sum은 정상 응답 경로를, fail은 실행되면 안 되는 command guard를 확인할 때 사용한다.
 */
export function createBasicRunnerCommandsClass() {
  return class BasicRunnerCommands {
    async sum(a: number, b: number) {
      return a + b;
    }

    async fail() {
      throw new Error("Should not run.");
    }
  };
}

/**
 * 새 Commands class API 검증용 fixture를 만든다.
 * prototype method 외에 instance field, accessor, static, symbol-keyed method,
 * `_` prefix method를 함께 두고 dispatch 노출 여부를 점검한다.
 */
export function createDeviceCommandsClass() {
  return class DeviceCommandsImpl {
    public state = "ready";
    public readonly iframeHelper: IframeHelper<DeviceNotificationsToHost>;

    constructor(helper: IframeHelper<DeviceNotificationsToHost>) {
      this.iframeHelper = helper;
    }

    async ping(): Promise<"pong"> {
      return "pong";
    }

    async echo(value: string): Promise<string> {
      return value;
    }

    async readState(): Promise<string> {
      // this 바인딩이 끊어지면 state 접근이 undefined가 되어 테스트가 실패한다.
      return this.state;
    }

    async fail(): Promise<void> {
      throw new TypeError("Device fail");
    }

    // instance field에 할당된 함수는 prototype에 없으므로 dispatch되지 않아야 한다.
    onInstance = async () => "should-not-dispatch";

    // `_` prefix method는 비공개 의도로 dispatch 대상에서 제외한다.
    async _hidden(): Promise<string> {
      return "hidden";
    }

    // `$` prefix는 라이브러리 점유 namespace로 dispatch 대상에서 제외한다.
    async $probe(): Promise<string> {
      return "should-not-dispatch";
    }

    static async onStatic(): Promise<string> {
      return "static";
    }

    get onGetter(): number {
      return 1;
    }

    // string-literal lifecycle 예약 method는 host에서도 host:dispose request로만 처리한다.
    // biome-ignore lint/complexity/useLiteralKeys: 의도적으로 computed key 형태로 host:dispose method 노출 회귀를 검증한다.
    async ["host:dispose"](): Promise<void> {}

    // symbol-keyed method도 dispatch에서 제외되어야 한다.
    async [Symbol("hidden")](): Promise<string> {
      return "symbol";
    }
  };
}
