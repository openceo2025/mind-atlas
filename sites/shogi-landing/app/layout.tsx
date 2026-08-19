import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "mind-atlas.org";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const socialImageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "Mind Atlas 将棋棋譜 | 気になった局面をすぐ見返す",
    description:
      "将棋ウォーズ、将棋クエスト、棋桜の棋譜をまとめ、分岐とメモを局面ごとに残せます。KIFの読み込み・再生・編集は無料です。",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Mind Atlas 将棋棋譜",
      description: "対局アプリの棋譜をまとめ、分岐とメモを局面ごとに残せます。",
      type: "website",
      locale: "ja_JP",
      images: [{ url: socialImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Mind Atlas 将棋棋譜",
      description: "対局アプリの棋譜をまとめ、分岐とメモを局面ごとに残せます。",
      images: [socialImageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
