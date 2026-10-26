#!/usr/bin/env bash
#
# 用极端时区各跑一遍日历验证。
#
# 为什么必须这样测：本地开发时机器时区恰好等于 APP_TIMEZONE（Asia/Shanghai），
# 「凌晨差一天」这类 bug 永远不会暴露。把服务端时区推到 UTC+14（基里巴斯，
# 全球最早）和 UTC-11（中途岛，最晚之一），任何依赖 UTC 判断「今天」的代码
# 都会立刻显形。
#
# 用法：bash scripts/verify-calendar.sh
set -uo pipefail

cd "$(dirname "$0")/.."

failures=0

for tz in "Pacific/Kiritimati" "Pacific/Midway" "Asia/Shanghai"; do
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  APP_TIMEZONE=$tz"
  echo "════════════════════════════════════════════════════════"

  # 必须重启 dev server —— 环境变量在进程启动时读取，改 .env.local 不一定被热加载
  pkill -f "next dev" 2>/dev/null
  sleep 2

  APP_TIMEZONE="$tz" pnpm dev > /tmp/family-note-dev.log 2>&1 &
  for _ in $(seq 1 50); do
    grep -q "Ready" /tmp/family-note-dev.log 2>/dev/null && break
    sleep 1
  done

  # 预热：dev server 首次请求要现编译，冷启动时 login 页面可能要十几秒。
  # 不预热的话测试会因为「登录失败」而误报，看起来像时区 bug。
  for _ in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 http://localhost:3000/login || echo 000)
    [ "$code" = "200" ] && break
    sleep 1
  done
  echo "  (预热完成，/login 返回 $code)"

  if ! APP_TIMEZONE="$tz" npx tsx scripts/verify-calendar.mts; then
    failures=$((failures + 1))
  fi
done

# 还原默认时区。
# 这里要连 .next 一起清 —— 反复 kill/重启 Turbopack 会让它的缓存进入
# 不一致状态，后续表现为某些路由莫名 404（排查了很久才定位到）。
pkill -f "next dev" 2>/dev/null
sleep 2
rm -rf .next
pnpm dev > /tmp/family-note-dev.log 2>&1 &
for _ in $(seq 1 50); do
  grep -q "Ready" /tmp/family-note-dev.log 2>/dev/null && break
  sleep 1
done
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 http://localhost:3000/login || echo 000)
  [ "$code" = "200" ] && break
  sleep 1
done

echo ""
if [ "$failures" -gt 0 ]; then
  echo "❌ $failures 个时区下有失败"
  exit 1
fi
echo "✅ 三个时区下全部通过"