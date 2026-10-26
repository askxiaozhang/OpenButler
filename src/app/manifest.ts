import type { MetadataRoute } from "next";

/**
 * PWA manifest。
 *
 * 目的是让手机上能「添加到主屏幕」当独立 App 用 —— 打开就是全屏，
 * 没有浏览器地址栏挡着。对家庭应用来说这点很重要：家里人在厨房、
 * 阳台打开时，少一层 chrome 就少一层摩擦。
 *
 * 也是为将来接 Web Push 打地基：推送要求应用先是可安装的 PWA，
 * 而且 iOS 上**必须**加到主屏才能收到通知。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "家庭管家",
    short_name: "家庭管家",
    id: "/",
    description: "家庭记事、周期提醒与 AI 管家",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // 与应用默认主题一致（globals.css 里的纸色背景）
    background_color: "#f7f8f2",
    theme_color: "#f7f8f2",
    lang: "zh-CN",
    categories: ["productivity", "lifestyle"],
    shortcuts: [
      {
        name: "查看待办",
        short_name: "待办",
        description: "打开家庭待办列表",
        url: "/tasks",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "打开管家",
        short_name: "管家",
        description: "与家庭管家对话",
        url: "/chat",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        // maskable：Android 会把它裁成圆形/水滴形等系统形状
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
