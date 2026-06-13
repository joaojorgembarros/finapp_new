// app/(tabs)/closures.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { formatBRLFromCents, formatDateBRFromYMD, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { ymd } from "../../src/lib/date";
import {
  listGoals,
  Goal,
  closeCycle,
  listCycleClosures,
  listGoalContributionsForCycle,
} from "../../src/lib/goals";
import { emitGoalsChanged, onGoalsChanged, onTxChanged } from "../../src/lib/bus";
import { getMonthlyNet, getNetBetween } from "../../src/lib/transactions";
import {
  getPayScheduleInfo,
  setPaySchedule,
  PayScheduleMode,
  listPastCycles,
  PayCycle,
} from "../../src/lib/paySchedule";

// ✅ aceita ponto e converte pra vírgula (pt-BR), 2 casas
export default function ClosuresTab() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [busy, setBusy] = useState(true);

  // schedule
  const [scheduleMode, setScheduleModeState] = useState<PayScheduleMode>("month");
  const [startYMD, setStartYMD] = useState<string>("1970-01-01");

  // ✅ limita ciclos carregados (pra ficar rápido)
  const [cyclesLimit, setCyclesLimit] = useState(12);

  const pastCycles = useMemo(
    () => listPastCycles(scheduleMode, new Date(), cyclesLimit, startYMD),
    [scheduleMode, startYMD, cyclesLimit]
  );

  const [selectedCycleKey, setSelectedCycleKey] = useState<string | null>(null);
  const selectedCycle: PayCycle | null = useMemo(() => {
    if (!selectedCycleKey) return null;
    return pastCycles.find((c) => c.cycleKey === selectedCycleKey) ?? null;
  }, [pastCycles, selectedCycleKey]);

  const [showPicker, setShowPicker] = useState(false);

  // closures map
  const [closuresMap, setClosuresMap] = useState<Record<string, any>>({});
  const [closureBusy, setClosureBusy] = useState(false);

  const closureExists = useMemo(() => {
    if (!selectedCycleKey) return false;
    return !!closuresMap[selectedCycleKey];
  }, [closuresMap, selectedCycleKey]);

  const pendingCount = useMemo(() => {
    if (!pastCycles.length) return 0;
    return pastCycles.filter((c) => !closuresMap[c.cycleKey]).length;
  }, [pastCycles, closuresMap]);

  const oldestPendingCycle = useMemo(() => {
    const pend = pastCycles.filter((c) => !closuresMap[c.cycleKey]);
    if (!pend.length) return null;
    return pend[pend.length - 1];
  }, [pastCycles, closuresMap]);

  // fechamento UI
  const [closing, setClosing] = useState(false);
  const [cycleNetCents, setCycleNetCents] = useState<number | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [closingSave, setClosingSave] = useState(false);
  const [existingAllocMap, setExistingAllocMap] = useState<Record<string, number>>({});

  // capacidade mensal
  const [netBusy, setNetBusy] = useState(false);
  const [monthlyNetCents, setMonthlyNetCents] = useState(0);
  const monthKey = useMemo(() => ymd(new Date()).slice(0, 7), []);

  // ✅ evita disparar loadClosures repetido em cascata
  const closuresFetchToken = useRef(0);

  const loadSchedule = useCallback(async () => {
    if (!householdId) return;
    try {
      const info = await getPayScheduleInfo(householdId);
      setScheduleModeState(info.mode);
      setStartYMD(info.startYMD);
    } catch {
      setScheduleModeState("month");
      setStartYMD("1970-01-01");
    }
  }, [householdId]);

  const loadGoals = useCallback(async () => {
    if (!householdId) return;
    const g = await listGoals(householdId);
    setGoals(g);
  }, [householdId]);

  const loadMonthlyNet = useCallback(async () => {
    if (!householdId) return;
    try {
      setNetBusy(true);
      const res: any = await (getMonthlyNet as any)(householdId, monthKey);
      const net = Number(res?.net_cents ?? res?.net ?? res?.netCents ?? 0) || 0;
      setMonthlyNetCents(net);
    } catch {
      setMonthlyNetCents(0);
    } finally {
      setNetBusy(false);
    }
  }, [householdId, monthKey]);

  // ✅ agora closures carrega “depois”, sem travar UI
  const loadClosures = useCallback(async () => {
    if (!householdId) return;

    const token = ++closuresFetchToken.current;
    try {
      setClosureBusy(true);

      const keys = pastCycles.map((c) => c.cycleKey);
      if (!keys.length) {
        setClosuresMap({});
        return;
      }

      const map = await listCycleClosures({ householdId, cycleKeys: keys });

      // se chegou uma resposta antiga, ignora
      if (token !== closuresFetchToken.current) return;

      setClosuresMap(map);
    } catch {
      // mantém o que já tem (melhor UX do que zerar)
    } finally {
      if (token === closuresFetchToken.current) setClosureBusy(false);
    }
  }, [householdId, pastCycles]);

  async function loadFast() {
    if (!householdId) return;

    try {
      setBusy(true);

      // ✅ primeiro: schedule+goals+net (rápido)
      await loadSchedule();
      await Promise.all([loadGoals(), loadMonthlyNet()]);

      // ✅ libera UI
      setBusy(false);

      // ✅ depois: closures (sem travar)
      setTimeout(() => {
        loadClosures();
      }, 50);
    } catch (e: any) {
      setBusy(false);
      Alert.alert("Erro", e?.message ?? "Falha ao carregar.");
    }
  }

  useEffect(() => {
    if (!hhLoading && householdId) loadFast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hhLoading, householdId]);

  // seleciona ciclo mais recente
  useEffect(() => {
    if (!pastCycles.length) {
      setSelectedCycleKey(null);
      return;
    }
    if (!selectedCycleKey || !pastCycles.some((c) => c.cycleKey === selectedCycleKey)) {
      setSelectedCycleKey(pastCycles[0].cycleKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastCycles]);

  // se mudar lista de ciclos (limit/start/mode), refaz closures mas sem travar
  useEffect(() => {
    if (!householdId || busy) return;
    loadClosures();
  }, [householdId, busy, loadClosures]);

  useEffect(() => {
    if (!householdId) return;

    const offTx = onTxChanged?.((ev: any) => {
      if (!ev?.householdId || ev.householdId !== householdId) return;
      loadMonthlyNet();
    });

    const offGoals = onGoalsChanged?.((ev: any) => {
      if (!ev?.householdId || ev.householdId !== householdId) return;
      loadGoals();
      // closures também, mas sem travar
      setTimeout(() => loadClosures(), 60);
    });

    return () => {
      try {
        offTx?.();
      } catch {}
      try {
        offGoals?.();
      } catch {}
    };
  }, [householdId, loadGoals, loadMonthlyNet, loadClosures]);

  async function onSetSchedule(mode: PayScheduleMode) {
    if (!userId || !householdId) return;
    try {
      setScheduleModeState(mode);
      await setPaySchedule({ householdId, userId, mode, settings: { start_ymd: startYMD } });

      setClosing(false);
      setCycleNetCents(null);
      setAlloc({});
      setExistingAllocMap({});

      // reabre lista com poucos ciclos e recarrega closures
      setCyclesLimit(12);
      setTimeout(() => loadClosures(), 80);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar regra de recebimento.");
    }
  }

  async function moveStartBackOneMonth() {
    if (!userId || !householdId) return;

    const d = new Date(`${startYMD}T00:00:00`);
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    const newStart = ymd(d);

    await setPaySchedule({ householdId, userId, mode: scheduleMode, settings: { start_ymd: newStart } });

    setStartYMD(newStart);
    setSelectedCycleKey(null);
    setCyclesLimit(12);
  }

  function centsToInput(cents: number) {
    if (!cents || cents <= 0) return "";
    return formatBRLFromCents(cents);
  }

  function suggestedAllocations(netCents: number) {
    let remaining = Math.max(0, netCents);
    const next: Record<string, string> = {};

    for (const g of goals as any[]) {
      if (remaining <= 0) break;

      const current = Number(g.current_cents ?? 0) || 0;
      const target = Number(g.target_cents ?? 0) || 0;
      const left = Math.max(0, target - current);

      if (left <= 0) {
        next[g.id] = "";
        continue;
      }

      const put = Math.min(left, remaining);
      remaining -= put;
      next[g.id] = formatBRLFromCents(put);
    }

    for (const g of goals) if (!(g.id in next)) next[g.id] = "";
    return next;
  }

  function allocTotalCents() {
    let total = 0;
    for (const gid of Object.keys(alloc)) total += Math.max(0, parseBRLToCents(alloc[gid]));
    return total;
  }

  async function openCloseCycleFor(cycle: PayCycle) {
    if (!householdId) return;

    const closure = closuresMap[cycle.cycleKey];
    const isClosed = !!closure;

    setSelectedCycleKey(cycle.cycleKey);
    setShowPicker(false);

    setClosing(true);
    setCycleNetCents(null);
    setAlloc({});
    setExistingAllocMap({});

    try {
      if (isClosed) {
        const netSnap = Number(closure?.net_cents ?? 0) || 0;

        const [contribMap] = await Promise.all([
          listGoalContributionsForCycle({ householdId, cycleKey: cycle.cycleKey }),
        ]);

        setCycleNetCents(netSnap);
        setExistingAllocMap(contribMap);

        const next: Record<string, string> = {};
        for (const g of goals) next[g.id] = centsToInput(contribMap[g.id] ?? 0);
        setAlloc(next);
        return;
      }

      const res: any = await (getNetBetween as any)(householdId, cycle.startYMD, cycle.endYMD);
      const net = Number(res?.net ?? 0) || 0;

      setCycleNetCents(net);
      setAlloc(suggestedAllocations(net));
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao abrir fechamento do ciclo.");
      setClosing(false);
    }
  }

  async function openCloseCycle() {
    if (!selectedCycle) return Alert.alert("Ciclo", "Selecione um ciclo para fechar.");
    return openCloseCycleFor(selectedCycle);
  }

  async function confirmClose() {
    if (!userId || !householdId) return;
    if (closingSave) return;
    if (!selectedCycle) return;

    const net = Number(cycleNetCents ?? 0) || 0;
    if (net <= 0) return Alert.alert("Sem sobra", "Este ciclo não teve sobra positiva para distribuir.");

    const total = allocTotalCents();
    if (total <= 0) return Alert.alert("Atenção", "Distribua um valor para pelo menos uma meta.");
    if (total > net) {
      return Alert.alert("Atenção", `Você distribuiu ${formatBRLFromCents(total)}, mas sobrou ${formatBRLFromCents(net)}.`);
    }

    try {
      setClosingSave(true);

      const allocations = (goals as any[])
        .map((g) => {
          const input = alloc[g.id] ?? "";
          const amountCents = Math.max(0, parseBRLToCents(input));
          const hadBefore = (existingAllocMap[g.id] ?? 0) > 0;
          const include = amountCents > 0 || hadBefore;
          return include ? { goalId: g.id, amountCents } : null;
        })
        .filter(Boolean) as Array<{ goalId: string; amountCents: number }>;

      await closeCycle({
        householdId,
        userId,
        mode: selectedCycle.mode,
        cycleKey: selectedCycle.cycleKey,
        cycleStart: selectedCycle.startYMD,
        cycleEnd: selectedCycle.endYMD,
        netCents: net,
        allocations,
      });

      setClosing(false);
      setCycleNetCents(null);
      setAlloc({});
      setExistingAllocMap({});

      await loadGoals();
      setTimeout(() => loadClosures(), 80);
      emitGoalsChanged({ householdId });

      Alert.alert("Fechado!", "Ciclo fechado e aportes aplicados nas metas.");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao fechar ciclo.");
    } finally {
      setClosingSave(false);
    }
  }

  const headerLabel = useMemo(() => {
    if (!selectedCycle) return "Selecione um ciclo";
    return `${formatDateBRFromYMD(selectedCycle.startYMD)} → ${formatDateBRFromYMD(selectedCycle.endYMD)}`;
  }, [selectedCycle]);

  return (
    <Screen>
      <AppHeader title="Fechamentos" subtitle="Feche ciclos e distribua a sobra nas metas" />

      {busy ? (
        <Card>
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        </Card>
      ) : (
        <>
          <Card intensity={18}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>Resumo</Text>

              <View
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: "rgba(255,255,255,0.72)",
                }}
              >
                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Pendentes: {pendingCount}</Text>
              </View>
            </Row>

            <View style={{ height: 8 }} />
            <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>
              Pendências contam apenas a partir de {formatDateBRFromYMD(startYMD)}.
            </Text>

            {oldestPendingCycle ? (
              <>
                <View style={{ height: 10 }} />
                <Button
                  title="Fechar pendência mais antiga"
                  onPress={() => openCloseCycleFor(oldestPendingCycle)}
                  disabled={!goals.length}
                />
              </>
            ) : (
              <View style={{ height: 10 }} />
            )}
          </Card>

          <Card intensity={18}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>Ciclos</Text>
            <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 6 }}>
              Isso define como os ciclos são montados.
            </Text>

            <View style={{ height: 10 }} />

            <Row style={{ gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title={scheduleMode === "month" ? "✓ Mês calendário" : "Mês calendário"}
                  onPress={() => onSetSchedule("month")}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={scheduleMode === "twice_month" ? "✓ 2x/mês" : "2x/mês"}
                  onPress={() => onSetSchedule("twice_month")}
                />
              </View>
            </Row>

            <View style={{ height: 10 }} />
            <Pressable
              onPress={moveStartBackOneMonth}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: "rgba(255,255,255,0.72)",
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "900" }}>Incluir mês anterior</Text>
            </Pressable>
          </Card>

          <Card intensity={18}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>Ciclo para fechar</Text>

              <Row style={{ gap: 10, alignItems: "center" }}>
                {closureBusy ? <ActivityIndicator /> : null}
                <Pressable onPress={() => setShowPicker((v) => !v)} hitSlop={10}>
                  <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>
                    {showPicker ? "Fechar lista" : "Escolher ciclo"}
                  </Text>
                </Pressable>
              </Row>
            </Row>

            <View style={{ height: 8 }} />
            <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{headerLabel}</Text>

            <View style={{ height: 8 }} />
            <Text style={{ color: closureExists ? theme.colors.good : theme.colors.pink, fontWeight: "900" }}>
              {closureExists ? "Fechado" : "Pendente"}
            </Text>

            {showPicker ? (
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Últimos ciclos:</Text>
                <View style={{ height: 8 }} />

                {pastCycles.map((c) => {
                  const isSel = c.cycleKey === selectedCycleKey;
                  const isClosed = !!closuresMap[c.cycleKey];

                  return (
                    <Pressable
                      key={c.cycleKey}
                      onPress={() => {
                        setSelectedCycleKey(c.cycleKey);
                        setShowPicker(false);
                        setClosing(false);
                        setCycleNetCents(null);
                        setAlloc({});
                        setExistingAllocMap({});
                      }}
                      style={{
                        paddingVertical: 10,
                        borderTopWidth: 1,
                        borderTopColor: theme.colors.border,
                        opacity: isSel ? 1 : 0.95,
                      }}
                    >
                      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ color: theme.colors.text, fontWeight: isSel ? "900" : "800" }}>
                          {formatDateBRFromYMD(c.startYMD)} → {formatDateBRFromYMD(c.endYMD)}
                        </Text>
                        <Text style={{ color: isClosed ? theme.colors.good : theme.colors.pink, fontWeight: "900" }}>
                          {isClosed ? "Fechado" : "Pendente"}
                        </Text>
                      </Row>
                    </Pressable>
                  );
                })}

                <View style={{ height: 10 }} />
                <Button
                  title="Carregar mais ciclos"
                  onPress={() => setCyclesLimit((n) => Math.min(60, n + 12))}
                />
              </View>
            ) : null}

            <View style={{ height: 14 }} />

            <Button
              title={closing ? "Abrindo..." : closureExists ? "Editar fechamento" : "Fechar ciclo"}
              onPress={openCloseCycle}
              disabled={!goals.length || !selectedCycle}
            />

            {closing ? (
              <View style={{ marginTop: 14 }}>
                <View style={{ height: 1, backgroundColor: theme.colors.border, opacity: 0.8, marginBottom: 14 }} />

                <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>
                  {closureExists ? "Editar fechamento do ciclo" : "Fechamento do ciclo"}
                </Text>

                <View style={{ height: 10 }} />

                {cycleNetCents === null ? (
                  <Row style={{ gap: 10 }}>
                    <ActivityIndicator />
                    <P muted>Carregando…</P>
                  </Row>
                ) : (
                  <>
                    <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Sobrou no ciclo:</Text>
                    <Text
                      style={{
                        color: cycleNetCents > 0 ? theme.colors.good : theme.colors.bad,
                        fontWeight: "900",
                        fontSize: 18,
                        marginTop: 6,
                      }}
                    >
                      {formatBRLFromCents(cycleNetCents)}
                    </Text>

                    <View style={{ height: 12 }} />
                    <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Distribua o valor entre as metas:</Text>
                    <View style={{ height: 10 }} />

                    {goals.map((g: any) => (
                      <View
                        key={g.id}
                        style={{
                          paddingVertical: 10,
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border,
                        }}
                      >
                        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{g.title}</Text>
                          <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>
                            {formatBRLFromCents(Number(g.current_cents ?? 0) || 0)} /{" "}
                            {formatBRLFromCents(Number(g.target_cents ?? 0) || 0)}
                          </Text>
                        </Row>

                        <View style={{ height: 8 }} />

                        <Input
                          value={alloc[g.id] ?? ""}
                          onChangeText={(t) => setAlloc((prev) => ({ ...prev, [g.id]: formatBRLInputFromDigits(t) }))}
                          placeholder="0,00"
                          keyboardType="number-pad"
                        />
                      </View>
                    ))}

                    <View style={{ height: 10 }} />
                    <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Total distribuído</Text>
                      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                        {formatBRLFromCents(allocTotalCents())}
                      </Text>
                    </Row>

                    <View style={{ height: 12 }} />
                    <Row style={{ gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          title="Sugerir"
                          onPress={() => setAlloc(suggestedAllocations(Math.max(0, cycleNetCents)))}
                          disabled={closingSave || closureExists}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          title="Zerar"
                          onPress={() => {
                            const z: Record<string, string> = {};
                            for (const gg of goals) z[gg.id] = "";
                            setAlloc(z);
                          }}
                          disabled={closingSave}
                        />
                      </View>
                    </Row>

                    <View style={{ height: 10 }} />
                    <Row style={{ gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          title={closingSave ? "Salvando..." : "Confirmar"}
                          onPress={confirmClose}
                          disabled={closingSave || (cycleNetCents || 0) <= 0}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          title="Cancelar"
                          onPress={() => {
                            setClosing(false);
                            setCycleNetCents(null);
                            setAlloc({});
                            setExistingAllocMap({});
                          }}
                          disabled={closingSave}
                        />
                      </View>
                    </Row>
                  </>
                )}
              </View>
            ) : null}
          </Card>

          <Card intensity={18}>
            <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>
              Capacidade mensal (projeção)
            </Text>

            <View style={{ height: 8 }} />

            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Saldo líquido do mês ({monthKey})</Text>

              {netBusy ? (
                <Row style={{ gap: 8, alignItems: "center" }}>
                  <ActivityIndicator />
                  <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>Calculando…</Text>
                </Row>
              ) : (
                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                  {formatBRLFromCents(monthlyNetCents)}
                </Text>
              )}
            </Row>

            <View style={{ height: 8 }} />
            <P muted>Obs: “saldo do mês” é diferente de “saldo do ciclo”.</P>
          </Card>
        </>
      )}
    </Screen>
  );
}
