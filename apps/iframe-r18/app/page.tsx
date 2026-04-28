"use client";

import type { IframeDebugEvent, IframeHelper } from "@cp949/iframecall/iframe";
import { useIframeCallRunner } from "@cp949/iframecall/iframe";
import { useEffect, useState } from "react";

type RunningStatus = "idle" | "processing";

type DemoCommands = {
  greet(name: string): Promise<string>;
  add(a: number, b: number): Promise<number>;
  delay(ms: number): Promise<void>;
};

// host에 노출되는 remote command와 별도로, iframe 내부에서 직접 호출하는 lifecycle/local API를 함께 잡는다.
// `_` prefix는 사용자 local-only이고 dispatch 대상에서 제외된다 (라이브러리는 `$` prefix를 점유).
type DemoCommandsLocal = DemoCommands & {
  _start(): void;
  _onStatusChange(fn: (s: RunningStatus) => void): () => void;
};

type DemoEvents = {
  "status-changed": RunningStatus;
};

class DemoCommandsImpl {
  private status: RunningStatus = "idle";
  private inflight = 0;
  private listeners = new Set<(s: RunningStatus) => void>();

  constructor(private iframeHelper: IframeHelper<DemoEvents>) {}

  _start(): void {
    this.iframeHelper.sendLifecycleReady();
  }

  _onStatusChange(fn: (s: RunningStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  // 동시 dispatch 중 가장 안쪽 호출이 끝나기 전에 idle로 떨어지지 않도록 refcount로 토글한다.
  async $onCommandRun(
    _cmd: string,
    _args: readonly unknown[],
    invoke: () => Promise<unknown>,
  ): Promise<unknown> {
    this.inflight += 1;
    if (this.inflight === 1) this._setStatus("processing");
    try {
      return await invoke();
    } finally {
      this.inflight -= 1;
      if (this.inflight === 0) this._setStatus("idle");
    }
  }

  private _setStatus(next: RunningStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.iframeHelper.sendNotificationToHost("status-changed", next);
    for (const fn of this.listeners) fn(next);
  }

  async greet(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }

  async add(a: number, b: number): Promise<number> {
    return a + b;
  }

  async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}

type LogEntry = { id: number; time: string; text: string };

let nextId = 0;

function makeEntry(text: string): LogEntry {
  return {
    id: nextId++,
    time: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
    text,
  };
}

function formatDebugEvent(ev: IframeDebugEvent): string {
  switch (ev.type) {
    case "commandReceivedFromHost":
      return `← call ${ev.command}(${ev.args.map((a) => JSON.stringify(a)).join(", ")})`;
    case "commandResultSentToHost":
      return `→ ${JSON.stringify(ev.value)}`;
    case "commandErrorSentToHost":
      return `→ Error: ${ev.error.message}`;
    case "notificationSentToHost":
      return `→ notify ${ev.event}: ${JSON.stringify(ev.payload)}`;
    case "notificationReceivedFromHost":
      return `← notify ${ev.event}: ${JSON.stringify(ev.payload)}`;
  }
}

const HOST_ORIGIN = "http://localhost:3302";

export default function IframePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const { iframeHelper, commands, isActive } = useIframeCallRunner<
    DemoCommandsLocal,
    DemoEvents
  >({
    targetOrigin: HOST_ORIGIN,
    allowedOrigins: [HOST_ORIGIN],
    Commands: DemoCommandsImpl,
    debugLog: true,
  });

  useEffect(() => {
    if (!iframeHelper || !commands) return;

    commands._start();

    const offStatus = commands._onStatusChange((s) => {
      setLogs((prev) => [...prev, makeEntry(`local status: ${s}`)]);
    });
    const offDebug = iframeHelper.debug.subscribe((ev) => {
      setLogs((prev) => [...prev, makeEntry(formatDebugEvent(ev))]);
    });

    return () => {
      offStatus();
      offDebug();
    };
  }, [iframeHelper, commands]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ marginBottom: 4 }}>iframecall demo — iframe (React 18)</h1>
      <p style={{ marginBottom: 12, color: "#666" }}>
        status: <strong>{isActive ? "active" : "initializing"}</strong>
      </p>

      <h2 style={{ marginBottom: 8 }}>Communication Log</h2>
      <div
        style={{
          height: 300,
          overflowY: "auto",
          border: "1px solid #ddd",
          padding: 8,
          background: "#fff",
          borderRadius: 4,
        }}
      >
        {logs.length === 0 && (
          <span style={{ color: "#aaa" }}>host 연결 대기 중…</span>
        )}
        {logs.map((log) => (
          <div key={log.id}>
            <span style={{ color: "#999" }}>{log.time}</span> {log.text}
          </div>
        ))}
      </div>
    </div>
  );
}
