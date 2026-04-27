// iframe 역할에서 사용하는 API와 타입만 노출한다. host 전용 API는 포함하지 않는다.

export {
  createIframeCallError,
  isSerializedIframeCallError,
  serializeIframeCallError,
} from "../core/errors.ts";
export type { ParsedIframeCallMessage } from "../core/messages.ts";
export {
  createIframeCallErrorResponse,
  createIframeCallNotify,
  createIframeCallRequest,
  createIframeCallSuccessResponse,
  parseIframeCallMessage,
} from "../core/messages.ts";
export type {
  IframeCallTransport,
  IframeCallTransportEvent,
} from "../core/transport.ts";
export { createParentWindowTransport } from "../core/transport.ts";
export type {
  CommandArgs,
  CommandHandler,
  CommandMap,
  CommandResult,
  CommandRunner,
  CommandsConstructor,
  DomainNotificationKey,
  IframeCallCallOptions,
  IframeCallLogger,
  IframeCallNotify,
  IframeCallRequest,
  IframeCallResponse,
  IframeCallRunnerClassOptions,
  IframeCallRunnerHandle,
  IframeCallRunnerOptions,
  IframeCallTransferable,
  IframeDebugEvent,
  IframeHelper,
  NotifyHandler,
  ReadyPolicy,
  ReservedNotificationName,
  SerializedIframeCallError,
} from "../core/types.ts";
export { consoleDebugLogger } from "./consoleDebugLogger.ts";
export { createIframeCallRunner } from "./runner.ts";
export type {
  UseIframeCallRunnerDebugLog,
  UseIframeCallRunnerOptions,
  UseIframeCallRunnerResult,
} from "./useIframeCallRunner.tsx";
export { useIframeCallRunner } from "./useIframeCallRunner.tsx";
