/**
 * iframecall public API의 type-level 계약을 검증하는 compile-only fixture.
 * tsc --noEmit으로만 검사하며 실제 runtime을 실행하지는 않는다.
 *
 * 검증 항목:
 * - generic default가 누락된 호출처에서 typecheck가 깨지지 않는다.
 * - controller.onNotificationFromIframe의 payload가 event 이름에 따라 추론된다.
 * - 명시적 command map 기반 controller.invoke가 reserved/instance-only key를 거부한다.
 * - runner.sendNotificationToHost가 명시적 notification map에서 lifecycle 예약 이름(`ready`)을 거부한다.
 * - RM-006 예약 API가 아직 public surface에 노출되지 않았음을 확인한다.
 */
import type {
  CommandsConstructor,
  IframeCallController,
  IframeCallRunnerHandle,
  IframeHelper,
} from "../../src/core/types.ts";
import { createIframeCallController } from "../../src/host/controller.ts";

/**
 * 명시적 command map. iframe 업체가 host에 노출할 prototype method 시그니처만 모은다.
 * runtime dispatch 가능 여부와 별개로 compile-only로 차단해야 하는 key는 이 map에 포함하지 않는다.
 */
type DeviceCommands = {
  ping(): Promise<"pong">;
  echo(value: string): Promise<string>;
  sum(a: number, b: number): number;
};

/**
 * iframe -> host notification map.
 * controller.onNotificationFromIframe payload 추론을 검증한다.
 */
type DeviceNotificationsFromIframe = {
  stateChanged: { isLoading: boolean };
  imageResult: { dataUrl: string };
};

/**
 * iframe -> host notification map. runner.sendNotificationToHost 검증에 사용한다.
 * lifecycle 예약 이름이 generic K로 추론되지 않는 것을 확인한다.
 */
type DeviceNotificationsToHost = {
  stateChanged: { isLoading: boolean };
  imageResult: { dataUrl: string };
};

/**
 * generic default 보존을 확인한다.
 * 단일 generic만 전달해도 두 번째 default가 채워져 typecheck가 통과해야 한다.
 */
declare const controllerDefault: IframeCallController<DeviceCommands>;
const _defaultDispose: () => Promise<void> = controllerDefault.dispose;

/**
 * onNotificationFromIframe payload 추론을 검증한다.
 */
declare const controller: IframeCallController<
  DeviceCommands,
  DeviceNotificationsFromIframe
>;

controller.onNotificationFromIframe("stateChanged", (payload) => {
  // payload는 { isLoading: boolean }로 추론되어야 한다.
  const flag: boolean = payload.isLoading;
  void flag;
});

controller.onNotificationFromIframe("imageResult", (payload) => {
  const url: string = payload.dataUrl;
  void url;
});

// @ts-expect-error notification map에 없는 event 이름은 거부한다.
controller.onNotificationFromIframe("unknownEvent", () => {});

// @ts-expect-error host -> iframe notification 송신 API는 RM-006 예약 상태라 아직 노출하지 않는다.
controller.sendNotificationToIframe("stateChanged", { isLoading: true });

/**
 * 명시적 command map 기준으로 정식 invoke와 deprecated call이 같은 반환/인자/key 계약을 지켜야 한다.
 * call은 이 호환성 블록에서만 검증하고, 정식 사용 예시는 invoke로 유지한다.
 * Commands class instance에 같이 존재하더라도 command map에 없으면 호출이 막혀야 한다.
 */

const _invokeResult: Promise<number> = controller.invoke("sum", [1, 2]);
void _invokeResult;

// @ts-expect-error sum은 number 두 개 인자만 받는다.
controller.invoke("sum", ["1", 2]);

// @ts-expect-error sum은 두 개보다 적은 인자 tuple을 받지 않는다.
controller.invoke("sum", [1]);

// @ts-expect-error sum은 두 개보다 많은 인자 tuple을 받지 않는다.
controller.invoke("sum", [1, 2, 3]);

// @ts-expect-error stateField는 instance field 값이라 command map에 없다.
controller.invoke("stateField", []);

// @ts-expect-error iframeHelper는 Commands constructor에 주입된 helper라 command가 아니다.
controller.invoke("iframeHelper", []);

// @ts-expect-error `_` prefix 메서드는 command map에 없다.
controller.invoke("_hidden", []);

// @ts-expect-error instance field 함수는 prototype command가 아니다.
controller.invoke("onInstance", []);

// @ts-expect-error host:dispose는 lifecycle 예약 이름이라 도메인 command로 노출되지 않는다.
controller.invoke("host:dispose", []);

/** deprecated call의 호환 타입 계약. */
const _callResult: Promise<number> = controller.call("sum", [1, 2]);
void _callResult;

// @ts-expect-error sum은 number 두 개 인자만 받는다.
controller.call("sum", ["1", 2]);

// @ts-expect-error sum은 두 개보다 적은 인자 tuple을 받지 않는다.
controller.call("sum", [1]);

// @ts-expect-error sum은 두 개보다 많은 인자 tuple을 받지 않는다.
controller.call("sum", [1, 2, 3]);

// @ts-expect-error stateField는 instance field 값이라 command map에 없다.
controller.call("stateField", []);

// @ts-expect-error iframeHelper는 Commands constructor에 주입된 helper라 command가 아니다.
controller.call("iframeHelper", []);

// @ts-expect-error `_` prefix 메서드는 command map에 없다.
controller.call("_hidden", []);

// @ts-expect-error instance field 함수는 prototype command가 아니다.
controller.call("onInstance", []);

// @ts-expect-error host:dispose는 lifecycle 예약 이름이라 도메인 command로 노출되지 않는다.
controller.call("host:dispose", []);

/**
 * runner handle generic default 검증.
 * 두 번째 generic default가 누락된 단일 generic 호출처도 typecheck를 유지한다.
 */
declare const runnerDefault: IframeCallRunnerHandle<DeviceCommands>;
const _defaultCommands: DeviceCommands = runnerDefault.commands;
const _defaultHelper: IframeHelper = runnerDefault.iframeHelper;

/**
 * 명시적 notification map이 주어진 runner handle.
 * sendNotificationToHost가 lifecycle 예약 이름을 거부하는지 확인한다.
 */
declare const runner: IframeCallRunnerHandle<
  DeviceCommands,
  DeviceNotificationsToHost
>;

runner.sendNotificationToHost("stateChanged", { isLoading: true });
runner.sendNotificationToHost("imageResult", { dataUrl: "data:," });

// @ts-expect-error sendNotificationToHost도 ready를 도메인 이름으로 받지 않는다.
runner.sendNotificationToHost("ready", { protocolVersion: 1 });

// @ts-expect-error host -> iframe notification 구독 API는 RM-006 예약 상태라 아직 노출하지 않는다.
runner.onNotificationFromHost("stateChanged", () => {});

/**
 * createIframeCallController 두 번째 generic 누락 시에도 typecheck가 유지되는지 확인한다.
 * 단일 generic 호출은 현재 public surface에서 계속 허용한다.
 */
declare const iframe: HTMLIFrameElement;
const _singleGenericController: IframeCallController<DeviceCommands> =
  createIframeCallController<DeviceCommands>({
    iframe,
    targetOrigin: "https://editor.example.com",
  });
void _singleGenericController;

/**
 * Commands constructor 형태가 새 generic을 그대로 받는지 확인한다.
 */
class _DeviceCommandsImpl {
  constructor(
    private readonly helper: IframeHelper<DeviceNotificationsToHost>,
  ) {
    void this.helper;
  }
  async ping(): Promise<"pong"> {
    return "pong";
  }
  async echo(value: string): Promise<string> {
    return value;
  }
  sum(a: number, b: number): number {
    return a + b;
  }
}

const _ctor: CommandsConstructor<DeviceCommands, DeviceNotificationsToHost> =
  _DeviceCommandsImpl;
void _ctor;
