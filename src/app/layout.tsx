import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { getConfig } from "../lib/config";
import { getUiCopy } from "../lib/ui-copy";
import { NavLinks } from "./nav-links";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "D-viva-assistant-agent",
  description: "Thesis defence prep",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const config = getConfig();
  const t = getUiCopy(config.uiLocale);
  const aiReady = config.effectiveAiEnabled && config.gatewayConfigured;
  const aiLabel =
    config.uiLocale === "zh-CN" ? `AI ${aiReady ? "已开启" : "关闭"}` : `AI ${aiReady ? "on" : "off"}`;
  const navItems = [
    { href: "/", label: t.nav.today, icon: "today" as const },
    { href: "/plan", label: t.nav.plan, icon: "plan" as const },
    { href: "/materials", label: t.nav.materials, icon: "materials" as const },
    { href: "/practice", label: t.nav.practice, icon: "practice" as const },
    { href: "/review", label: t.nav.review, icon: "review" as const },
    { href: "/import", label: t.nav.import, icon: "import" as const },
    { href: "/library", label: t.nav.library, icon: "library" as const },
  ];

  return (
    <html
      lang={t.htmlLang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div className="flex items-center gap-10 md:block">
              <Link href="/" className="flex items-center gap-10 md:gap-3">
                <span className="brand-mark">D</span>
                <span className="hidden text-base font-semibold leading-tight text-[#17211d] md:block">
                  D-viva-<br />assistant-agent
                </span>
              </Link>
              <NavLinks items={navItems} />
            </div>

            <div className="desktop-only absolute bottom-20 left-5 right-5 rounded-lg border border-[#d9e3df] bg-white p-4 text-sm shadow-sm">
              <div className="flex items-center gap-2 font-semibold text-[#0d6b5b]">
                <span className="h-2 w-2 rounded-full bg-[#0d6b5b]" />
                {config.uiLocale === "zh-CN" ? "本地模式" : "Local mode"}
              </div>
              <p className="mt-1 text-xs text-[#64716b]">
                {config.uiLocale === "zh-CN" ? "数据仅保存在本机" : "Data stays on this machine"}
              </p>
              <Link href="/library" className="mt-3 inline-flex text-xs font-semibold text-[#006b5b]">
                {config.uiLocale === "zh-CN" ? "隐私与安全设置" : "Privacy & safety settings"}
              </Link>
            </div>
          </aside>

          <main className="main-shell">
            <div className="topbar">
              <div className="mobile-brand items-center gap-3">
                <span className="brand-mark">D</span>
                <div>
                  <h1 className="font-semibold">D-viva-assistant-agent</h1>
                  <p className="text-sm text-[#64716b]">
                    {config.uiLocale === "zh-CN"
                      ? "本地优先论文 viva 准备工作台"
                      : "Local-first thesis viva preparation workspace"}
                  </p>
                </div>
              </div>
              <div className="hidden shrink-0 items-center gap-2 sm:flex">
                <span className="badge badge-green">{config.uiLocale === "zh-CN" ? "本地已保存" : "Saved locally"}</span>
                <span className={`badge ${aiReady ? "badge-green" : "badge-zinc"}`}>{aiLabel}</span>
              </div>
            </div>
            <div className="content-wrap">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
