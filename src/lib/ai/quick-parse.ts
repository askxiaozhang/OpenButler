import { addDays, type DateOnly } from "@/lib/time";
import { guessAnchorOn } from "@/lib/validation/routine";
import type { AnchorOn, Freq } from "@/generated/prisma/client";
import type {
  IntakeAction,
  IntakeResult,
  ManualDraft,
  MemberRef,
  RoutineInput,
} from "./types";

/**
 * 中文快速解析器 —— 不依赖任何模型。
 *
 * ## 为什么这段代码值得认真写
 *
 * 用户「后面才接入 AI」，意味着**这是绝大多数时间里的主路径**，不是边缘分支。
 * 它把「没配 key」的体验从一个什么都不懂的空表单，变成「小管家大概能听懂你」。
 * 这是产品感受上的质变。
 *
 * ## 铁律：只填表，永不直接写库
 *
 * 它产出的是 `ManualDraft`（预填好的表单载荷），最终仍由用户确认后才落库。
 * 因为契约如此，~80% 的准确率就变成了纯收益而不是风险：
 * 解析对了省掉整表填写，解析错了用户改一个字段。
 *
 * ## 覆盖范围（按命中率排序）
 *
 * - 相对日期：今天 / 明天 / 后天 / N 天后 / N 天以后
 * - 周期：每 N 天 / 每周 / 每月一次 / 每 N 个月 / 每天
 * - 意图：提醒我… → 待办；…了（句尾）→ 记录
 * - 角色：取**最长**别名命中（「老妈」优先于「妈」）
 */

// ---------------------------------------------------------------- 中文数字

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/**
 * 解析中文数字。覆盖到 99 就够 —— 家庭场景里的天数/间隔不会更大
 * （「三百六十五天后」这种说法没人用，直接写数字更快）。
 */
export function parseChineseNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "半") return 0.5;

  // 十 / 十二 / 二十 / 二十三
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    const tensValue = tens === "" ? 1 : (CN_DIGITS[tens] ?? null);
    if (tensValue === null) return null;
    const onesValue = ones === "" ? 0 : (CN_DIGITS[ones] ?? null);
    if (onesValue === null) return null;
    return tensValue * 10 + onesValue;
  }

  let value = 0;
  for (const ch of text) {
    const d = CN_DIGITS[ch];
    if (d === undefined) return null;
    value = value * 10 + d;
  }
  return text.length > 0 ? value : null;
}

/** 匹配「数字」的词：阿拉伯数字或中文数字。 */
const NUM = "(\\d+|[零〇一二两三四五六七八九十]+)";

// ---------------------------------------------------------------- 日期

interface DateHit {
  date: DateOnly;
  /** 在原文中的匹配片段，用于从标题里剔除 */
  matched: string;
}

const WEEKDAY_OFFSET: Record<string, number> = {
  一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6,
};

/** 从一句话里找出日期表达。找不到返回 null。 */
export function parseDate(text: string, today: DateOnly): DateHit | null {
  // 顺序很重要：先长后短，「大后天」必须在「后天」之前匹配
  const fixed: [RegExp, number][] = [
    [/大后天/, 3],
    [/后天/, 2],
    [/明天|明日/, 1],
    [/今天|今日|今晚/, 0],
    [/昨天|昨日/, -1],
    [/前天/, -2],
  ];
  for (const [re, offset] of fixed) {
    const m = re.exec(text);
    if (m) return { date: addDays(today, offset), matched: m[0] };
  }

  // 「31 天后」「两周以后」「3 天之后」
  const rel = new RegExp(`${NUM}\\s*(天|日|周|个?月|年)\\s*(后|以后|之后|后边|过后)`).exec(text);
  if (rel) {
    const n = parseChineseNumber(rel[1]);
    if (n !== null) {
      const unit = rel[2];
      const days =
        unit === "天" || unit === "日"
          ? n
          : unit === "周"
            ? n * 7
            : unit === "月" || unit === "个月"
              ? Math.round(n * 30)
              : Math.round(n * 365);
      return { date: addDays(today, days), matched: rel[0] };
    }
  }

  // 「下周三是」「下周三」——没有明确动词时也认
  const nextWeek = /下(?:个)?周([一二三四五六日天])/.exec(text);
  if (nextWeek) {
    const target = WEEKDAY_OFFSET[nextWeek[1]];
    if (target !== undefined) {
      // 下周一 = 本周一 + 7；先跳到本周一再加
      const weekdayIdx = (["日", "一", "二", "三", "四", "五", "六"] as const).indexOf(
        new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" })
          .format(new Date(`${today}T00:00:00Z`))
          .slice(0, 3) as never,
      );
      const todayWeekday = weekdayIdx === -1 ? 1 : (weekdayIdx + 6) % 7; // 周一=0
      const delta = 7 - todayWeekday + target;
      return { date: addDays(today, delta), matched: nextWeek[0] };
    }
  }

  return null;
}

/** 用户明确说出的钟点，未给分钟时取整点，不猜上午/下午。 */
export function parseClockTime(text: string): { time: string; matched: string } | null {
  const hit = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚)?\s*(\d{1,2}|[零〇一二两三四五六七八九十]+)\s*(?:[:：]\s*(\d{1,2})|[点时](?:\s*(半|一刻|三刻|\d{1,2}|[零〇一二两三四五六七八九十]+)\s*分?)?)/.exec(text);
  if (!hit) return null;
  let hour = parseChineseNumber(hit[2]);
  const minuteText = hit[3] ?? hit[4];
  const minute = minuteText === "半" ? 30 : minuteText === "一刻" ? 15 : minuteText === "三刻" ? 45 : minuteText ? parseChineseNumber(minuteText) : 0;
  if (hour === null || minute === null || minute > 59 || hour > 23) return null;
  const period = hit[1] ?? (text.includes("今晚") ? "晚上" : "");
  if (["下午", "傍晚", "晚上", "今晚"].includes(period) && hour < 12) hour += 12;
  if (period === "中午" && hour < 11) hour += 12;
  if ((period === "凌晨" || period === "早上" || period === "上午") && hour === 12) hour = 0;
  return { time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, matched: hit[0] };
}

// ---------------------------------------------------------------- 周期

interface FreqHit {
  freq: Exclude<Freq, "ONCE">;
  interval: number;
  matched: string;
  /** 规则里隐含的日号（「每月 1 号」），用于回填起始日 */
  anchorDay?: number;
}

/** 从一句话里找出周期表达。找不到返回 null。 */
export function parseFrequency(text: string): FreqHit | null {
  // 「每月一次」「每个月」「每月」「每 3 个月」
  const monthlyOnce = /(每|每个)月(一次|一回|1次)?/.exec(text);
  const everyNMonths = new RegExp(`每\\s*${NUM}\\s*个?月`).exec(text);

  // 顺序：带数字的优先，否则「每月一次」会被「每月」吃掉
  if (everyNMonths) {
    const n = parseChineseNumber(everyNMonths[1]);
    if (n !== null && n > 1) {
      return { freq: "MONTHLY", interval: n, matched: everyNMonths[0] };
    }
  }

  const monthlyDay = /每(?:个)?月\s*(\d+|[零〇一二两三四五六七八九十]+)\s*[号日]/.exec(text);
  if (monthlyDay) {
    const day = parseChineseNumber(monthlyDay[1]);
    if (day !== null && day >= 1 && day <= 31) {
      return { freq: "MONTHLY", interval: 1, matched: monthlyDay[0], anchorDay: day };
    }
  }

  if (monthlyOnce) {
    return { freq: "MONTHLY", interval: 1, matched: monthlyOnce[0] };
  }

  const everyNDays = new RegExp(`每\\s*${NUM}\\s*天`).exec(text);
  if (everyNDays) {
    const n = parseChineseNumber(everyNDays[1]);
    if (n !== null) return { freq: "DAILY", interval: n, matched: everyNDays[0] };
  }

  const everyNWeeks = new RegExp(`每\\s*${NUM}\\s*(?:个)?周`).exec(text);
  if (everyNWeeks) {
    const n = parseChineseNumber(everyNWeeks[1]);
    if (n !== null) return { freq: "WEEKLY", interval: n, matched: everyNWeeks[0] };
  }

  const everyNYears = new RegExp(`每\\s*${NUM}\\s*年`).exec(text);
  if (everyNYears) {
    const n = parseChineseNumber(everyNYears[1]);
    if (n !== null) return { freq: "YEARLY", interval: n, matched: everyNYears[0] };
  }

  // 无限定词的「每天/每周/每年」
  if (/每(天|日)/.test(text)) {
    return { freq: "DAILY", interval: 1, matched: /每(天|日)/.exec(text)![0] };
  }
  if (/每(个)?周/.test(text)) {
    return { freq: "WEEKLY", interval: 1, matched: /每(个)?周/.exec(text)![0] };
  }
  if (/每年/.test(text)) {
    return { freq: "YEARLY", interval: 1, matched: "每年" };
  }

  return null;
}

// ---------------------------------------------------------------- 角色

/**
 * 找出提到的人。
 *
 * **取最长命中**：「老妈」必须优先于「妈」，否则「老妈」会被切成「老」+ 妈的误匹配。
 * 别名数组一并参与匹配，且同样按长度排序。
 */
export function findMembers(
  text: string,
  members: MemberRef[],
): { subjectId: string | null; assigneeId: string | null; matched: string[] } {
  // 「提醒我」「帮我」「记一下」里的「我」是说话人自指，是触发词不是角色。
  // 不先剔掉的话，「提醒我31天后，提醒妈…」会把「我」当成要办事的人。
  const scannable = text.replace(/(提醒|帮|叫|通知|告诉)\s*我/g, "$1");

  type Candidate = { id: string; word: string };
  const candidates: Candidate[] = [];
  for (const m of members) {
    for (const word of [m.name, ...m.aliases]) {
      if (word) candidates.push({ id: m.id, word });
    }
  }
  candidates.sort((a, b) => b.word.length - a.word.length);

  const hits: Candidate[] = [];
  let working = scannable;
  for (const c of candidates) {
    if (working.includes(c.word)) {
      hits.push(c);
      // 命中后从待匹配文本里挖掉，避免「老妈」命中后「妈」又命中一次
      working = working.split(c.word).join(" ".repeat(c.word.length));
    }
  }
  const matched = hits.map((h) => h.word);

  // 只有一个角色时，按句意判断是「关于谁」还是「谁去办」
  if (hits.length === 1) {
    const afterRemind = new RegExp(`提醒\\s*${escapeRegExp(hits[0].word)}`).test(scannable);
    return afterRemind
      ? { subjectId: null, assigneeId: hits[0].id, matched }
      : { subjectId: hits[0].id, assigneeId: null, matched };
  }

  // 两个角色：第一个当主体，第二个当执行人（「提醒妈给猫咪喂药」的形态）
  if (hits.length >= 2) {
    const withRemind = hits.findIndex((h) =>
      new RegExp(`提醒\\s*${escapeRegExp(h.word)}`).test(scannable),
    );
    if (withRemind >= 0) {
      const others = hits.filter((_, i) => i !== withRemind);
      return {
        subjectId: others[0]?.id ?? null,
        assigneeId: hits[withRemind].id,
        matched,
      };
    }
    return { subjectId: hits[0].id, assigneeId: hits[1].id, matched };
  }

  return { subjectId: null, assigneeId: null, matched };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------- 意图

/** 触发词。剔除后剩下的才是标题。 */
const TRIGGER_PATTERNS: RegExp[] = [
  /提醒我/g,
  /提醒一下/g,
  /提醒/g,
  /记得/g,
  /别忘了/g,
  /别忘记/g,
  /要/g,
  /该/g,
  /帮我/g,
  /记录/g,
  /记一下/g,
  /记一笔/g,
];

/** 是不是「已经发生了」的记录。句尾的「了」是最强信号。 */
export function looksLikeRecord(text: string): boolean {
  if (/提醒|记得|别忘了|要记着/.test(text)) return false;
  return /了[。！!~\s]*$/.test(text) || /^(今天|昨天|刚才|刚刚)/.test(text);
}

// ---------------------------------------------------------------- 主流程

/**
 * 从一句话里提取标题：把已识别的角色、日期、周期、触发词片段都剔除，剩下的就是。
 *
 * 这个「减法」策略比正向匹配标题更稳 —— 中文里「做什么」的表达太自由，
 * 正向枚举永远不够；而「不是角色/不是时间/不是触发词」的剩余部分，
 * 恰好就是核心动作词。
 */
function stripFragments(text: string, fragments: string[]): string {
  let out = text;
  for (const frag of fragments) {
    if (frag) out = out.split(frag).join(" ");
  }
  for (const re of TRIGGER_PATTERNS) {
    out = out.replace(re, " ");
  }
  return out;
}

/** 把已经剔除过片段的一段文本清洗成标题。 */
function cleanTitle(text: string): string {
  return text
    // 去掉标点和多余空白
    .replace(/[，,。.、；;：:！!？?~～\s]+/g, " ")
    // 句尾残余的「了」
    .replace(/了\s*$/, "")
    .trim();
}

/**
 * 把一句话切成多个子项（「掏耳朵、剃屁股毛、剪指甲」）。
 *
 * ️ 必须在标点规范化**之前**切分 —— extractTitle 会把 `、` 统一替换成空格，
 * 切完再规范化就切不动了。这个顺序错过一次：四条周期项被压成了一条待办。
 */
function splitRawItems(text: string): string[] {
  return text
    .split(/[、，,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface QuickParseInput {
  text: string;
  members: MemberRef[];
  /** 「今天」。由调用方传入，解析器不自己算日期（CLAUDE.md 纪律 1）。 */
  today: DateOnly;
}

/**
 * 快速解析的结果。比 IntakeResult 多一个 `recognized`。
 *
 * `recognized` 表示「这句话里到底有没有认出东西」—— 认出了角色、日期或周期
 * 里的任何一个。一个都没认出来时，我们其实只是把原话抄成了标题，
 * 这种「结果」不该伪装成一次成功的解析。
 */
export type QuickParseResult = IntakeResult & { recognized: boolean };

/**
 * 解析一句话。**永不抛错、永不死路** —— 最差也返回一个可用的话术与草稿。
 */
export function quickParse(input: QuickParseInput): QuickParseResult {
  const text = input.text.trim();
  const { members, today } = input;

  const dateHit = parseDate(text, today);
  const freqHit = parseFrequency(text);
  const timeHit = parseClockTime(text);
  const memberHit = findMembers(text, members);
  const isRecord = looksLikeRecord(text);

  const date = dateHit?.date ?? today;

  /**
   * 到底认出了什么没有。
   *
   * 三个信号任一命中就算认出来了。一个都没命中说明我们只是在照抄原话 ——
   * 这时该老实说「没听懂」并退到手动表单，而不是伪装成一次成功的解析
   * （弹一张「我理解为：待办『asdfgh』」的卡片对用户毫无帮助）。
   */
  const recognized = Boolean(
    memberHit.subjectId ||
      memberHit.assigneeId ||
      timeHit ||
      dateHit ||
      freqHit ||
      looksLikeStructured(text),
  );

  const fragments = [
    ...memberHit.matched,
    timeHit?.matched ?? "",
    dateHit?.matched ?? "",
    freqHit?.matched ?? "",
  ];

  // 先剔除片段、再按分隔符切分、最后逐项清洗。
  // 顺序反了就会把 `、` 一起洗成空格，切不出多个子项 ——
  // 「掏耳朵、剃屁股毛、剪指甲、扽」会退化成一条标题叫「掏耳朵 剃屁股毛 剪指甲 扽」的待办。
  const stripped = stripFragments(text, fragments);
  const items = splitRawItems(stripped)
    .map(cleanTitle)
    .filter(Boolean);

  const title = items[0] ?? cleanTitle(stripped) ?? text;

  // ---- 有周期表达且不是「已经发生」→ 定义周期项
  //
  // 语义判断：说「猫咪每月一次掏耳朵」是在**定义一件反复发生的事**，
  // 不是待办也不是记录。所以只要带周期，就归到周期项 —— 哪怕只有一项。
  if (freqHit && !isRecord && memberHit.subjectId) {
    const routineItems: RoutineInput[] = (items.length > 0 ? items : [title]).map(
      (itemTitle) => ({
        title: itemTitle,
        freq: freqHit.freq,
        interval: freqHit.interval,
        anchorOn: guessAnchorOn(itemTitle),
        reminderTime: timeHit?.time,
        // 「每月 1 号」这类说法里日号是内生的，用它回填起始日
        startOn: freqHit.anchorDay
          ? alignToDay(date, freqHit.anchorDay)
          : date,
      }),
    );

    const actions: IntakeAction[] = [
      { type: "createRoutines", subjectId: memberHit.subjectId, items: routineItems },
    ];
    return {
      ok: true,
      source: "rules",
      actions,
      summary: buildSummary(actions, members, today),
      recognized,
    };
  }

  // ---- 记录：已经发生的事，可带出后续周期（「猫咪今天掏耳朵了，每 14 天」）
  if (isRecord) {
    const followUp: RoutineInput | undefined = freqHit
      ? {
          title,
          freq: freqHit.freq,
          interval: freqHit.interval,
          anchorOn: guessAnchorOn(title) as AnchorOn,
          startOn: date,
        }
      : undefined;

    const actions: IntakeAction[] = [
      {
        type: "createRecord",
        subjectId: memberHit.subjectId,
        assigneeId: memberHit.assigneeId,
        title,
        occurredOn: date,
        followUp,
      },
    ];
    return {
      ok: true,
      source: "rules",
      actions,
      summary: buildSummary(actions, members, today),
      recognized,
    };
  }

  // ---- 待办。带周期但没提角色时也保留周期信息（见 types.ts 里 followUp 的说明）
  const actions: IntakeAction[] = [
    {
      type: "createTask",
      subjectId: memberHit.subjectId,
      assigneeId: memberHit.assigneeId,
      title,
      dueOn: date,
      reminderTime: timeHit?.time,
      followUp: freqHit
        ? {
            title,
            freq: freqHit.freq,
            interval: freqHit.interval,
            anchorOn: guessAnchorOn(title) as AnchorOn,
            reminderTime: timeHit?.time,
            startOn: freqHit.anchorDay ? alignToDay(date, freqHit.anchorDay) : date,
          }
        : undefined,
    },
  ];

  return {
    ok: true,
    source: "rules",
    actions,
    summary: buildSummary(actions, members, today),
    recognized,
  };
}

/**
 * 句子本身是不是「像一件事」而不像乱码。
 *
 * 用途：一段完全没有角色/日期/周期的文本（「买酱油」就是典型），
 * 如果读起来像句人话就当成一件事处理；否则判为没听懂。
 *
 * 判据是**汉字占比**而不是光看有没有汉字：
 * - 「买酱油」→ 3 个汉字 / 3 个非空字符 = 100%，是句人话
 * - 「asdfgh 乱码 %%%」→ 2 个汉字 / 11 个非空字符 = 18%，是乱码
 *
 * 只看「有没有汉字」的话后者会被误判（这版之前就是这么错的）。
 * 阈值放宽到 50% —— 宁可多给一张确认卡片，也不要动不动就说「没听懂」。
 */
function looksLikeStructured(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 2 || compact.length > 60) return false;
  const han = (compact.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  return han >= 2 && han / compact.length >= 0.5;
}

/**
 * 把日期对齐到指定的日号。
 *
 * 「每月 1 号交物业费」里，起始日必须是某个月的 1 号，否则周期会从
 * 「今天」起算，日号就跟着变成今天了 —— 用户的「1 号」就白说了。
 */
function alignToDay(date: DateOnly, day: number): DateOnly {
  const [year, month, currentDay] = date.split("-").map(Number);
  if (currentDay === day) return date;
  // 本月还没到那个日号就用本月，否则下个月
  const target = new Date(Date.UTC(year, month - 1, day));
  const current = new Date(Date.UTC(year, month - 1, currentDay));
  if (target.getTime() < current.getTime()) {
    return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  }
  return target.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- 复述

function describeDate(date: DateOnly, today: DateOnly): string {
  if (date === today) return "今天";
  for (const [offset, label] of [
    [1, "明天"],
    [2, "后天"],
    [3, "大后天"],
    [-1, "昨天"],
  ] as const) {
    if (date === addDays(today, offset)) return label;
  }
  const [, m, d] = date.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function describeFreq(item: RoutineInput): string {
  const n = item.interval;
  if (item.freq === "DAILY") return n === 1 ? "每天" : `每 ${n} 天`;
  if (item.freq === "WEEKLY") return n === 1 ? "每周" : `每 ${n} 周`;
  if (item.freq === "MONTHLY") return n === 1 ? "每月" : `每 ${n} 个月`;
  return n === 1 ? "每年" : `每 ${n} 年`;
}

/** 给用户看的一句话复述。确认卡片上显示的就是它。 */
export function buildSummary(
  actions: IntakeAction[],
  members: MemberRef[],
  today: DateOnly,
): string {
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const m = members.find((x) => x.id === id);
    return m ? `${m.name}` : null;
  };

  const parts: string[] = [];

  for (const action of actions) {
    if (action.type === "createRecord") {
      const who = nameOf(action.subjectId);
      parts.push(
        [
          `记录「${action.title}」`,
          who ? `关于 ${who}` : null,
          describeDate(action.occurredOn, today),
        ]
          .filter(Boolean)
          .join(" · "),
      );
      if (action.followUp) {
        parts.push(`${describeFreq(action.followUp)}提醒你`);
      }
    } else if (action.type === "createTask") {
      const subject = nameOf(action.subjectId);
      const assignee = nameOf(action.assigneeId);
      parts.push(
        [
          `待办「${action.title}」`,
          subject ? `关于 ${subject}` : null,
          assignee ? `要 ${assignee} 办` : null,
          describeDate(action.dueOn, today),
          action.reminderTime ? `${action.reminderTime} 提醒` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } else if (action.type === "createRoutines") {
      const who = nameOf(action.subjectId) ?? "";
      const items = action.items
        .map((i) => `${i.title}（${describeFreq(i)}${i.reminderTime ? ` ${i.reminderTime} 提醒` : ""}）`)
        .join("、");
      parts.push(`${who} 的周期项：${items}`);
    } else if (action.type === "completeTask") {
      parts.push(`完成「${action.title}」`);
    } else if (action.type === "reschedule") {
      parts.push(`把「${action.title}」改到 ${describeDate(action.dueOn, today)}`);
    }
  }

  return parts.join("；");
}

/**
 * 生成降级草稿。
 *
 * 这是「功能完全不受影响」的落点：解析不出来时，用户拿到的是一张已经
 * 填好一部分的表单，而不是空白。
 */
export function buildDraft(input: QuickParseInput): ManualDraft {
  const result = quickParse(input);
  const today = input.today;

  if (result.ok && result.actions.length > 0) {
    const first = result.actions[0];
    if (first.type === "createRecord") {
      return {
        rawText: input.text,
        kind: "record",
        title: first.title,
        subjectId: first.subjectId,
        assigneeId: first.assigneeId,
        date: first.occurredOn,
        routine: first.followUp,
      };
    }
    if (first.type === "createTask") {
      return {
        rawText: input.text,
        kind: "task",
        title: first.title,
        subjectId: first.subjectId,
        assigneeId: first.assigneeId,
        date: first.dueOn,
        reminderTime: first.reminderTime,
      };
    }
    if (first.type === "createRoutines") {
      return {
        rawText: input.text,
        kind: "task",
        title: first.items[0]?.title ?? input.text,
        subjectId: first.subjectId,
        assigneeId: null,
        date: first.items[0]?.startOn ?? today,
      };
    }
  }

  // 彻底没解析出东西：至少把原话放进标题，用户改两个字就能用
  return {
    rawText: input.text,
    kind: looksLikeRecord(input.text) ? "record" : "task",
    title: input.text.slice(0, 60),
    subjectId: null,
    assigneeId: null,
    date: today,
  };
}
