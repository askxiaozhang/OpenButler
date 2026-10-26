import { House, Leaf } from "lucide-react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/guard";

export const metadata = { title: "登录 · Open家庭管家" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // 已登录的直接放行，免得看到登录页还要再点一次
  const user = await getCurrentUser();
  if (user) redirect("/");

  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center p-5 md:p-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[2rem] border bg-card shadow-[0_16px_80px_#244b3b08] md:grid-cols-2">
        <section className="relative flex flex-col justify-between overflow-hidden bg-sidebar p-8 text-sidebar-foreground md:min-h-[540px] md:p-10">
          <div className="flex items-center gap-3">
            <House className="size-6" strokeWidth={1.5} />
            <span className="text-lg font-semibold tracking-wide">OpenButler</span>
          </div>
          <div className="relative z-10 mt-12 md:my-12">
            <p className="mb-5 text-[10px] tracking-[0.25em] text-sidebar-foreground/55">Open家庭管家</p>
            <h1 className="text-3xl leading-relaxed font-medium tracking-wide md:text-4xl">小事有人记，<br />日子更从容。</h1>
            <p className="mt-5 max-w-xs text-sm leading-7 text-sidebar-foreground/65">家人的叮嘱，宠物的护理，<br />还有那些值得记住的日常。</p>
          </div>
          <Leaf aria-hidden="true" className="absolute -right-6 bottom-0 size-48 -rotate-12 text-sidebar-foreground/5" strokeWidth={0.6} />
          <p className="relative hidden text-xs text-sidebar-foreground/50 md:block">一家人的生活，一起好好照顾。</p>
        </section>
        <section className="flex flex-col justify-center p-8 md:p-12">
          <h2 className="text-2xl font-semibold">欢迎回家</h2>
          <p className="text-muted-foreground mt-2 mb-8 text-sm">登录，看看家里的新安排。</p>
          <LoginForm next={next} />
          <p className="text-muted-foreground/80 mt-8 text-center text-xs">留心小事，好好生活。</p>
        </section>
      </div>
    </main>
  );
}