// src/lib/paySchedule.ts
import { supabase } from "./supabase";

export type PayScheduleMode = "month" | "twice_month";

export type PaySchedule = {
  household_id: string;
  mode: PayScheduleMode;
  settings?: any;
  created_at?: string;
  updated_at?: string;
};

export type PayScheduleInfo = {
  mode: PayScheduleMode;
  startYMD: string; // a partir de quando ciclos contam
};

export type PayCycle = {
  mode: PayScheduleMode;
  cycleKey: string;
  startYMD: string; // inclusive
  endYMD: string; // exclusive
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymdFromDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYMD(s: string) {
  const [yy, mm, dd] = String(s).split("-").map(Number);
  return new Date(yy, (mm || 1) - 1, dd || 1);
}

function isWeekend(d: Date) {
  const w = d.getDay();
  return w === 0 || w === 6;
}

function prevBusinessDay(d: Date) {
  const x = new Date(d);
  while (isWeekend(x)) x.setDate(x.getDate() - 1);
  return x;
}

function lastBusinessDayOfMonth(year: number, monthIndex0: number) {
  const x = new Date(year, monthIndex0 + 1, 0);
  return prevBusinessDay(x);
}

function payday15(year: number, monthIndex0: number) {
  const d = new Date(year, monthIndex0, 15);
  return prevBusinessDay(d);
}

function uniqueSortedYMD(list: string[]) {
  return Array.from(new Set(list)).sort();
}

/**
 * Retorna:
 * - close: último ciclo que JÁ terminou (end <= hoje)
 * - current: ciclo atual em andamento
 */
export function computeCycles(mode: PayScheduleMode, now = new Date()): { close: PayCycle; current: PayCycle } {
  const todayYMD = ymdFromDate(now);

  if (mode === "month") {
    const startCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
    const endCurrent = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const startClose = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endClose = new Date(now.getFullYear(), now.getMonth(), 1);

    const closeStart = ymdFromDate(startClose);
    const closeEnd = ymdFromDate(endClose);
    const curStart = ymdFromDate(startCurrent);
    const curEnd = ymdFromDate(endCurrent);

    return {
      close: { mode, cycleKey: `${mode}:${closeStart}->${closeEnd}`, startYMD: closeStart, endYMD: closeEnd },
      current: { mode, cycleKey: `${mode}:${curStart}->${curEnd}`, startYMD: curStart, endYMD: curEnd },
    };
  }

  const y = now.getFullYear();
  const m0 = now.getMonth();

  const candidates: string[] = [];
  for (let delta = -2; delta <= 2; delta++) {
    const d = new Date(y, m0 + delta, 1);
    const yy = d.getFullYear();
    const mm0 = d.getMonth();
    candidates.push(ymdFromDate(payday15(yy, mm0)));
    candidates.push(ymdFromDate(lastBusinessDayOfMonth(yy, mm0)));
  }

  const paydays = uniqueSortedYMD(candidates);

  let lastIdx = -1;
  for (let i = 0; i < paydays.length; i++) {
    if (paydays[i] <= todayYMD) lastIdx = i;
  }
  if (lastIdx < 0) lastIdx = 0;

  const endClose = paydays[lastIdx];
  const startClose = paydays[Math.max(0, lastIdx - 1)];

  const startCur = endClose;
  let endCur = paydays[lastIdx + 1] ?? paydays[lastIdx];

  if (endCur === startCur) {
    const dNext = new Date(parseYMD(startCur));
    dNext.setMonth(dNext.getMonth() + 1);

    const yy = dNext.getFullYear();
    const mm0 = dNext.getMonth();
    const nextA = ymdFromDate(payday15(yy, mm0));
    const nextB = ymdFromDate(lastBusinessDayOfMonth(yy, mm0));
    endCur = [nextA, nextB].sort()[0];
  }

  return {
    close: { mode, cycleKey: `${mode}:${startClose}->${endClose}`, startYMD: startClose, endYMD: endClose },
    current: { mode, cycleKey: `${mode}:${startCur}->${endCur}`, startYMD: startCur, endYMD: endCur },
  };
}

/**
 * ✅ Lista ciclos passados para selecionar (pra fechar atrasado)
 * - Somente ciclos com end <= hoje
 * - E somente ciclos a partir de startYMD (cadastro/ativação)
 */
export function listPastCycles(
  mode: PayScheduleMode,
  now = new Date(),
  count = 12,
  startYMD?: string
): PayCycle[] {
  const todayYMD = ymdFromDate(now);
  const startLimit = String(startYMD || "1970-01-01"); // fallback

  if (mode === "month") {
    const out: PayCycle[] = [];
    for (let i = 1; i <= count + 24; i++) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const s = ymdFromDate(start);
      const e = ymdFromDate(end);

      if (e <= todayYMD && e > startLimit) {
        out.push({ mode, cycleKey: `${mode}:${s}->${e}`, startYMD: s, endYMD: e });
      }

      if (out.length >= count) break;
    }
    return out; // mais recente -> mais antigo
  }

  const paydays: string[] = [];
  const startMonth = new Date(now.getFullYear(), now.getMonth() - 18, 1);
  const endMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);

  const cur = new Date(startMonth);
  while (cur < endMonth) {
    const yy = cur.getFullYear();
    const mm0 = cur.getMonth();
    paydays.push(ymdFromDate(payday15(yy, mm0)));
    paydays.push(ymdFromDate(lastBusinessDayOfMonth(yy, mm0)));
    cur.setMonth(cur.getMonth() + 1);
  }

  const sorted = uniqueSortedYMD(paydays);

  const cycles: PayCycle[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i - 1];
    const e = sorted[i];
    if (e <= todayYMD && e > startLimit) {
      cycles.push({ mode, cycleKey: `${mode}:${s}->${e}`, startYMD: s, endYMD: e });
    }
  }

  return cycles.slice(-count).reverse(); // mais recente -> mais antigo
}

export async function getPayScheduleInfo(householdId: string): Promise<PayScheduleInfo> {
  const sb: any = supabase;

  const { data, error } = await sb
    .from("pay_schedules")
    .select("mode,settings,created_at")
    .eq("household_id", householdId)
    .maybeSingle();

  if (error) throw error;

  const mode = (data?.mode as PayScheduleMode) || "month";

  const settings = data?.settings ?? {};
  const startFromSettings = settings?.start_ymd || settings?.startYMD;

  const startYMD =
    (typeof startFromSettings === "string" && startFromSettings.length >= 10
      ? String(startFromSettings).slice(0, 10)
      : (data?.created_at ? String(data.created_at).slice(0, 10) : ymdFromDate(new Date())));

  return { mode, startYMD };
}

export async function setPaySchedule(args: {
  householdId: string;
  userId: string;
  mode: PayScheduleMode;
  settings?: any;
}) {
  const sb: any = supabase;

  const mergedSettings = { ...(args.settings ?? {}) };
  if (!mergedSettings.start_ymd && !mergedSettings.startYMD) {
    mergedSettings.start_ymd = ymdFromDate(new Date()); // ✅ default: hoje
  }

  const payload = {
    household_id: args.householdId,
    mode: args.mode,
    settings: mergedSettings,
    updated_by: args.userId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from("pay_schedules").upsert(payload, { onConflict: "household_id" });
  if (error) throw error;
}
