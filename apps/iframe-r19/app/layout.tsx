import type { Metadata } from "next";
// Next.js 16 typegen이 전역 React.ReactNode 인스턴스를 요구해 named import 대신 namespace 사용.
import type React from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "iframecall demo — iframe (React 19)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
