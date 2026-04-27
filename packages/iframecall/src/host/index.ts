// host 역할에서 사용하는 API와 타입만 노출한다. iframe 전용 API는 포함하지 않는다.

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
export { createIframeWindowTransport } from "../core/transport.ts";
export type {
  CommandArgs,
  CommandHandler,
  CommandMap,
  CommandResult,
  CommandRunner,
  HostDebugEvent,
  IframeCallCallOptions,
  IframeCallController,
  IframeCallControllerOptions,
  IframeCallLogger,
  IframeCallNotify,
  IframeCallRequest,
  IframeCallResponse,
  IframeCallTransferable,
  NotifyHandler,
  ReadyPolicy,
  ReservedNotificationName,
  SerializedIframeCallError,
} from "../core/types.ts";
export { consoleDebugLogger } from "./consoleDebugLogger.ts";
export { createIframeCallController } from "./controller.ts";
export type {
  IframeCallControllerStatus,
  UseIframeCallControllerDebugLog,
  UseIframeCallControllerOptions,
  UseIframeCallControllerResult,
} from "./useIframeCallController.tsx";
export { useIframeCallController } from "./useIframeCallController.tsx";
