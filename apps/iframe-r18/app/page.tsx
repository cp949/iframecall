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
type DemoCommandsLocal = DemoCommands & {
  start(): void;
  updateRunningStatus(status: RunningStatus): void;
  onStatusChange(fn: (s: RunningStatus) => void): () => void;
};

type DemoEvents = {
  "status-changed": RunningStatus;
};

class DemoCommandsImpl {
  private status: RunningStatus = "idle";
  private listeners = new Set<(s: RunningStatus) => void>();

  constructor(private iframeHelper: IframeHelper<DemoEvents>) {}

  start(): void {
    this.iframeHelper.sendLifecycleReady();
  }

  updateRunningStatus(next: RunningStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.iframeHelper.sendNotificationToHost("status-changed", next);
    for (const fn of this.listeners) fn(next);
  }

  onStatusChange(fn: (s: RunningStatus) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async greet(name: string): Promise<string> {
    this.updateRunningStatus("processing");
    try {
      return `Hello, ${name}!`;
    } finally {
      this.updateRunningStatus("idle");
    }
  }

  async add(a: number, b: number): Promise<number> {
    this.updateRunningStatus("processing");
    try {
      return a + b;
    } finally {
      this.updateRunningStatus("idle");
    }
  }

  async delay(ms: number): Promise<void> {
    this.updateRunningStatus("processing");
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
    } finally {
      this.updateRunningStatus("idle");
    }
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

    commands.start();

    const offStatus = commands.onStatusChange((s) => {
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
