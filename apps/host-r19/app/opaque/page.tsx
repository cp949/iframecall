"use client";

// opaque origin 모드 수동 검증 페이지.
// iframe-r19 앱을 sandbox="allow-scripts"로 띄워 origin을 "null"로 만들고, host는 opaqueOrigin: true로 통신한다.
// "iframe 교체" 버튼은 iframe 요소를 새로 만들어 key 리마운트 계약(이전 요청 reject, 새 window 재연결)을 확인한다.

import type { HostDebugEvent } from "@cp949/iframecall/host";
import { useIframeCallController } from "@cp949/iframecall/host";
// monorepo에 react 18/19 typings이 동시 존재해 함수 반환 타입 추론이 portable하지 않다는 TS2883 회피용.
import type React from "react";
import { useEffect, useState } from "react";

type AppCommands = {
  greet(name: string): Promise<string>;
  delay(ms: number): Promise<void>;
};

const IFRAME_URL = "http://localhost:3301";

function formatDebugEvent(ev: HostDebugEvent): string {
  switch (ev.type) {
    case "commandSentToIframe":
      return `→ invoke ${ev.command}(${ev.args.map((a) => JSON.stringify(a)).join(", ")})`;
    case "commandResultReceivedFromIframe":
      return `← ${JSON.stringify(ev.value)}`;
    case "commandErrorReceivedFromIframe":
      return `← Error: ${ev.error.message}`;
    case "notificationReceivedFromIframe":
      return `← notify ${ev.event}: ${JSON.stringify(ev.payload)}`;
    case "readyReceived":
      return "← ready";
    case "terminatedReceived":
      return `← terminated: ${ev.reason}`;
  }
}

function SandboxFrame({
  onLog,
}: {
  onLog: (text: string) => void;
}): React.JSX.Element {
  const { iframeRef, controller, status } =
    useIframeCallController<AppCommands>({
      opaqueOrigin: true,
      debugLog: true,
    });

  useEffect(() => {
    if (!controller) return;
    return controller.debug.subscribe((ev) => onLog(formatDebugEvent(ev)));
  }, [controller, onLog]);

  const run = (promise: Promise<unknown> | undefined) => {
    promise?.catch((error: unknown) => {
      onLog(`✕ ${(error as { code?: string }).code ?? String(error)}`);
    });
  };

  return (
    <div>
      <p>
        status: <strong data-testid="status">{status}</strong>
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          disabled={status !== "ready"}
          onClick={() => run(controller?.invoke("greet", ["opaque"]))}
        >
          greet
        </button>
        <button
          type="button"
          disabled={status !== "ready"}
          onClick={() => run(controller?.invoke("delay", [5000]))}
        >
          delay(5000)
        </button>
      </div>
      {/* SSR된 iframe은 hydration 전에 ready를 보내 유실될 수 있다. controller 생성 뒤 src를 설정한다. */}
      <iframe
        ref={iframeRef}
        src={controller ? IFRAME_URL : undefined}
        sandbox="allow-scripts"
        style={{ width: "100%", height: 300, border: "1px solid #ddd" }}
        title="iframecall opaque origin demo"
      />
    </div>
  );
}

export default function OpaqueHostPage(): React.JSX.Element {
  const [frameKey, setFrameKey] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [onLog] = useState(
    () => (text: string) => setLogs((prev) => [...prev, text]),
  );

  return (
    <div style={{ padding: 16 }}>
      <h1>iframecall demo — opaque origin host (React 19)</h1>
      <button
        type="button"
        onClick={() => {
          onLog(`— iframe 교체 (key ${frameKey + 1}) —`);
          setFrameKey((k) => k + 1);
        }}
      >
        iframe 교체
      </button>
      <SandboxFrame key={frameKey} onLog={onLog} />
      <h2>Communication Log</h2>
      <pre data-testid="log" style={{ background: "#fff", padding: 8 }}>
        {logs.join("\n")}
      </pre>
    </div>
  );
}
