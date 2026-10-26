import type { Metadata, Viewport } from "next";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "家庭管家",
  description: "家庭记事、周期提醒与 AI 管家",
  // PWA：手机上「添加到主屏幕」后按独立 App 打开，而不是套在浏览器地址栏里
  appleWebApp: {
    capable: true,
    title: "家庭管家",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 允许内容延伸到刘海/圆角区域，配合 safe-area padding 使用
  viewportFit: "cover",
  themeColor: "#f7f8f2",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // 轻盈的纸色背景，与移动端状态栏保持一致。
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <PwaProvider>{children}</PwaProvider>
      </body>
    </html>
  );
}
