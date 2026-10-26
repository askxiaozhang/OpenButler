#!/usr/bin/env bash
#
# 全量回归：单测 + 各阶段端到端验证。
#
# 会自己起 dev server 和 headless Edge，跑完再收拾干净。
# 用法：bash scripts/verify-all.sh
set -uo pipefail

cd "$(dirname "$0")/.."

failures=0
step() { echo ""; echo "════════ $1 ════════"; }

cleanup() {
  pkill -f "next dev" 2>/dev/null
  pkill -f "edge-test-profile" 2>/dev/null
  sleep 1
  rm -rf /tmp/edge-test-profile 2>/dev/null
}
trap cleanup EXIT

# ---------------------------------------------------------------- 静态检查
step "静态检查"
pnpm typecheck || failures=$((failures + 1))
pnpm lint || failures=$((failures + 1))

step "单元测试"
pnpm test || failures=$((failures + 1))

# ---------------------------------------------------------------- 起环境
step "启动 dev server"
cleanup
pnpm dev > /tmp/family-note-dev.log 2>&1 &
for _ in $(seq 1 60); do
  grep -q "Ready" /tmp/family-note-dev.log 2>/dev/null && break
  sleep 1
done

# 预热：dev server 首次请求要现编译，冷启动可能十几秒。
# 不预热的话测试会因为「登录失败」误报，看起来像功能坏了。
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 http://localhost:3000/login || echo 000)
  [ "$code" = "200" ] && break
  sleep 1
done
if [ "$code" != "200" ]; then
  echo "dev server 起不来（/login 返回 $code），放弃"
  exit 1
fi
echo "  dev server 就绪"

# 先把上次残留清掉。
# 任何一次运行失败都会跳过它自己的清理，残留会在下一次运行时伪装成
# 「功能坏了」（点恢复恢复错人、排序点了没反应…），浪费大量排查时间。
step "清理上次残留的测试数据"
npx tsx scripts/clean-test-data.mts || echo "  （清理失败，继续）"

step "启动 headless Edge"
rm -rf /tmp/edge-test-profile
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --headless=new --remote-debugging-port=9222 --remote-allow-origins='*' \
  --user-data-dir=/tmp/edge-test-profile --no-first-run --no-default-browser-check \
  about:blank > /tmp/edge-test.log 2>&1 &
for _ in $(seq 1 30); do
  curl -s --max-time 3 http://localhost:9222/json/version >/dev/null 2>&1 && break
  sleep 1
done
curl -s --max-time 5 http://localhost:9222/json/version >/dev/null 2>&1 \
  && echo "  Edge 就绪" \
  || { echo "Edge 起不来，跳过浏览器验证"; exit 1; }

# ---------------------------------------------------------------- 端到端
run() {
  step "$1"
  if ! npx tsx "$2"; then failures=$((failures + 1)); fi
}

run "鉴权（实库）"          scripts/verify-auth.mts
run "HTTP 链路"            scripts/verify-http.mts
run "登录流程（浏览器）"    scripts/verify-login-browser.mts
run "角色管理"             scripts/verify-members.mts
run "记录与待办"           scripts/verify-entries.mts
run "周期引擎"             scripts/verify-routines.mts
run "AI 管家"              scripts/verify-intake.mts

# 日历要换时区重跑，单独一个脚本
step "日历（三个时区）"
if ! bash scripts/verify-calendar.sh; then failures=$((failures + 1)); fi

echo ""
echo "════════════════════════════════════════"
if [ "$failures" -gt 0 ]; then
  echo "❌ $failures 组失败"
  exit 1
fi
echo "✅ 全部通过"