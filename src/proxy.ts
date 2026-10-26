import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * 请求守卫（Next.js 16 里 `middleware.ts` 已改名 `proxy.ts`）。
 *
 * 这里**只做廉价的 cookie 存在性检查**，不验签、不查库。原因：
 * proxy 会在每个请求上执行、且可能被部署到 CDN 节点，官方文档明确建议
 * 「不要依赖共享模块或全局状态」。真正的身份校验交给
 * `(app)/layout.tsx` 里的 `requireUser()`（验签 + 查库）。
 *
 * 这个分工的代价是：伪造一个同名 cookie 就能通过这一层 —— 但那只是让它
 * 走到布局组件，随后仍会被 requireUser() 拦下重定向。不存在越权风险。
 *
 * 好处是静态资源、登录页、公开页面完全不碰数据库。
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const hasSessionCookie = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    // 记住原本想去的地址，登录后跳回去（只记 pathname+search，避免开放重定向）
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", `${pathname}${search}`);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * 明确列出需要守卫的页面，而不是「匹配所有再排除」。
   *
   * 用负向匹配（`/((?!_next|api).*)`）容易漏掉新增的公开路由，而且一旦写错
   * 会把 CSS/JS 也拦下来，页面白屏但控制台没有报错，很难排查。
   * 页面数量就这么几个，正向列举更好维护。
   */
  matcher: [
    "/",
    "/tasks/:path*",
    "/calendar/:path*",
    "/records/:path*",
    "/products/:path*",
    "/routines/:path*",
    "/members/:path*",
    "/users/:path*",
    "/settings/:path*",
  ],
};
