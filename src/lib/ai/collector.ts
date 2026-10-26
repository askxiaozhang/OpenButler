import type { IntakeAction, MemberRef, RoutineInput } from "./types";
import type { AnchorOn, Freq } from "@/generated/prisma/client";

import type { DateOnly } from "@/lib/time";

/**
 * 模型给出的周期规则片段。
 *
 * 只含 freq/interval/anchorOn —— `title` 和 `startOn` 由所属的记录/待办派生
 * （周期名就是记录名，起始日就是发生日），让模型重复输出这两个字段
 * 既冗余又容易不一致。
 */
export interface RoutineSpec {
  freq: Exclude<Freq, "ONCE">;
  interval: number;
  anchorOn: AnchorOn;
  reminderTime?: string | null;
}

/**
 * tool 提案的收集器。
 *
 * **所有 tool 的 execute 都只往这里推提案，不写数据库。**
 *
 * 这是「AI 只出计划」这条设计的落点：LLM 解析是非确定性的，把「妈」误判成
 * 「猫咪」然后静默写进家庭记录，信任一次就没了。收集器把 tool 调用变成
 * 一份待确认的清单，用户点确认后才由 `confirmIntake` 落库。
 *
 * 副作用是 `lib/ai/` 整个模块变成纯的、可单元测试的 —— execute 里没有
 * 数据库、没有事务、没有网络。
 */
export class ActionCollector {
  private actions: IntakeAction[] = [];
  private unresolvedMembers = new Set<string>();

  constructor(private readonly members: MemberRef[]) {}

  /**
   * 按名字找角色。找不到就记下来 —— 模型可能会说「外婆」这种库里没有的角色，
   * 静默丢掉会让用户以为 AI 没听懂，记下来可以在确认卡片上提示。
   */
  private resolveMember(name: string | undefined | null): string | null {
    if (!name) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;

    const lower = trimmed.toLowerCase();
    // 先精确匹配名字，再匹配别名，最后退到「包含」——
    // 模型有时会输出「妈妈」而库里存的是「妈」
    const exact =
      this.members.find((m) => m.name === trimmed) ??
      this.members.find((m) => m.aliases.includes(trimmed));
    if (exact) return exact.id;

    const fuzzy =
      this.members.find((m) => m.name.includes(trimmed) || trimmed.includes(m.name)) ??
      this.members.find((m) =>
        [...m.aliases, m.name].some(
          (w) => w.toLowerCase().includes(lower) || lower.includes(w.toLowerCase()),
        ),
      );
    if (fuzzy) return fuzzy.id;

    this.unresolvedMembers.add(trimmed);
    return null;
  }

  pushRecord(input: {
    memberName?: string;
    assigneeName?: string;
    title: string;
    occurredOn: DateOnly;
    note?: string;
    followUp?: RoutineSpec;
  }) {
    this.actions.push({
      type: "createRecord",
      subjectId: this.resolveMember(input.memberName),
      assigneeId: this.resolveMember(input.assigneeName),
      title: input.title,
      note: input.note ?? null,
      occurredOn: input.occurredOn,
      followUp: this.completeRoutine(input.followUp, input.title, input.occurredOn),
    });
  }

  /** 把模型给的规则片段补成完整的 RoutineInput。 */
  private completeRoutine(
    spec: RoutineSpec | undefined,
    title: string,
    startOn: DateOnly,
  ): RoutineInput | undefined {
    if (!spec) return undefined;
    return {
      title,
      freq: spec.freq,
      interval: Math.max(1, Math.trunc(spec.interval)),
      anchorOn: spec.anchorOn,
      reminderTime: spec.reminderTime,
      startOn,
    };
  }

  pushTask(input: {
    memberName?: string;
    assigneeName?: string;
    title: string;
    dueOn: DateOnly;
    reminderTime?: string | null;
    note?: string;
    followUp?: RoutineSpec;
  }) {
    this.actions.push({
      type: "createTask",
      subjectId: this.resolveMember(input.memberName),
      assigneeId: this.resolveMember(input.assigneeName),
      title: input.title,
      note: input.note ?? null,
      dueOn: input.dueOn,
      reminderTime: input.reminderTime,
      followUp: this.completeRoutine(input.followUp, input.title, input.dueOn),
    });
  }

  pushRoutines(input: { memberName: string; items: RoutineInput[] }) {
    const subjectId = this.resolveMember(input.memberName);
    if (!subjectId || input.items.length === 0) return;
    this.actions.push({ type: "createRoutines", subjectId, items: input.items });
  }

  /** 收集到的提案。 */
  getActions(): IntakeAction[] {
    return this.actions;
  }

  /** 模型提到但库里没有的角色名。UI 上提示用户去建。 */
  getUnresolvedMembers(): string[] {
    return [...this.unresolvedMembers];
  }

  get isEmpty(): boolean {
    return this.actions.length === 0;
  }
}