// src/lib/bus.ts

type TxPayload = { householdId?: string };
type GoalsPayload = { householdId?: string };

let txListeners: Array<(p: TxPayload) => void> = [];
let goalsListeners: Array<(p: GoalsPayload) => void> = [];

export function onTxChanged(fn: (p: TxPayload) => void) {
  txListeners.push(fn);
  return () => {
    txListeners = txListeners.filter((x) => x !== fn);
  };
}

export function emitTxChanged(payload: TxPayload) {
  for (const fn of txListeners) fn(payload);
}

// ✅ NOVO: metas
export function onGoalsChanged(fn: (p: GoalsPayload) => void) {
  goalsListeners.push(fn);
  return () => {
    goalsListeners = goalsListeners.filter((x) => x !== fn);
  };
}

export function emitGoalsChanged(payload: GoalsPayload) {
  for (const fn of goalsListeners) fn(payload);
}

