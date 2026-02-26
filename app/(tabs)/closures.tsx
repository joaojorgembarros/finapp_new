// app/(tabs)/closures.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from "react-native";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { ymd } from "../../src/lib/date";
import { formatBRLFromCents, formatDateBRFromYMD, parseBRLToCents } from "../../src/lib/format";
import { getNetBetween } from "../../src/lib/transactions";
import {
  listGoals,
  Goal,
  closeCycle,
  listCycleClosures,
  listGoalContributionsForCycle,
} from "../../src/lib/goals";
import {
  getPayScheduleInfo,
  setPaySchedule,
  PayScheduleMode,
  listPastCycles,
  PayCycle,
} from "../../src/lib/paySchedule";
import { emitGoalsChanged, onGoalsChanged, onTxChanged } from "../../src/lib/bus";

type FilterMode = "pending" | "closed" | "all";

// ✅ aceita ponto e converte pra vírgula (pt-BR), 2 casas
function normalizeMoneyBR(text: string) {
  if (!text) return "";
  let s = text.replace(/[^\d.,]/g, "");
  s = s.replace(/\./g, ",");
  const idx = s.indexOf(",");
  if (idx >= 0) {
    const intPart = s.slice(0, idx).replace(/[^\d]/g, "");
    const decPart = s.slice(idx + 1).replace(/[^\d]/g, "").slice(0, 2);
    return decPart.length ? `${intPart},${decPart}` : `${intPart},`;
  }
  return s.replace(/[^\d]/g, "");
}

function centsToInput(cents: number) {
  if (!cents || cents <= 0) return "";
  return normalizeMoneyBR((cents / 100).toFixed(2).replace(".", ","));
}

function SegmentedFilter({
  value,
  onChange,
}: {
  value: FilterMode;
  onChange: (v: FilterMode) => void;
}) {
  const opts: Array<{ key: FilterMode; label: string }> = [
    { key: "pending", label: "Pendentes" },
    { key: "closed", label: "Fechados" },
    { key: "all", label: "Todos" },
  ];

  return (
    <View style={seg.wrap}>
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[seg.item, active && seg.itemActive]}
          >
            <Text numberOfLines={1} style={[seg.text, active && seg.textActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const seg = StyleSheet.create({
  wrap: { flexDirection: "row", gap: 10 },
  item: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  itemActive: {
    borderColor: "rgba(0,240,255,0.40)",
    backgroundColor: "rgba(0,240,255,0.10)",
  },
  text: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },
  textActive: { color: theme.colors.primary },
});

export default function ClosuresTab() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);

  // loading suave
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const [filter, setFilter] = useState<FilterMode>("pending");
  const [showSettings, setShowSettings] = useState(false);

  // schedule
  const [scheduleMode, setScheduleModeState] = useState<PayScheduleMode>("month");
  const [startYMD, setStartYMD] = useState<string>("1970-01-01");

  // perf: carrega poucos ciclos e pode aumentar
  const [cyclesLimit, setCyclesLimit] = useState(10);

  const pastCycles = useMemo(() => {
    return listPastCycles(scheduleMode, new Date(), cyclesLimit, startYMD);
  }, [scheduleMode, cyclesLimit, startYMD]);

  // closures map
  const [closuresMap, setClosuresMap] = useState<Record<string, any>>({});

  // metas (pra distribuição)
  const [goals, setGoals] = useState<Goal[]>([]);

  // modal detalhe
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCycle, setDetailCycle] = useState<PayCycle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cycleNetCents, setCycleNetCents] = useState<number | null>(null);

  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [existingAllocMap, setExistingAllocMap] = useState<Record<string, number>>({});
  const [savingDetail, setSavingDetail] = useState(false);

  const closureExists = useMemo(() => {
    if (!detailCycle) return false;
    return !!closuresMap[detailCycle.cycleKey];
  }, [detailCycle, closuresMap]);

  const filteredCycles = useMemo(() => {
    if (!pastCycles.length) return [];
    return pastCycles.filter((c) => {
      const isClosed = !!closuresMap[c.cycleKey];
      if (filter === "pending") return !isClosed;
      if (filter === "closed") return isClosed;
      return true;
    });
  }, [pastCycles, closuresMap, filter]);

  const pendingCount = useMemo(() => {
    if (!pastCycles.length) return 0;
    return pastCycles.filter((c) => !closuresMap[c.cycleKey]).length;
  }, [pastCycles, closuresMap]);

  const oldestPending = useMemo(() => {
    const pend = pastCycles.filter((c) => !closuresMap[c.cycleKey]);
    if (!pend.length) return null;
    return pend[pend.length - 1];
  }, [pastCycles, closuresMap]);

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
    try {
      const g = await listGoals(householdId);
      setGoals(g);
    } catch {
      setGoals([]);
    }
  }, [householdId]);

  const loadClosures = useCallback(async () => {
    if (!householdId) return;
    try {
      const keys = pastCycles.map((c) => c.cycleKey);
      const map = await listCycleClosures({ householdId, cycleKeys: keys });
      setClosuresMap(map);
    } catch {
      setClosuresMap({});
    }
  }, [householdId, pastCycles]);

  const loadAll = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (!householdId) return;
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        if (mode === "initial") setInitialLoading(true);
        else setRefreshing(true);

        // schedule primeiro, depois o resto
        await loadSchedule();
        await Promise.all([loadGoals(), loadClosures()]);
      } finally {
        inFlight.current = false;
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [householdId, loadSchedule, loadGoals, loadClosures]
  );

  useEffect(() => {
    if (!hhLoading && householdId) loadAll("initial");
  }, [hhLoading, householdId, loadAll]);

  // sempre que mudar cyclesLimit/mode/start, atualiza closures do novo conjunto
  useEffect(() => {
    if (!householdId) return;
    loadClosures();
  }, [householdId, loadClosures]);

  // live updates
  useEffect(() => {
    if (!householdId) return;

    const offTx = onTxChanged?.((ev: any) => {
      if (!ev?.householdId || ev.householdId !== householdId) return;
      loadAll("refresh");
    });

    const offGoals = onGoalsChanged?.((ev: any) => {
      if (!ev?.householdId || ev.householdId !== householdId) return;
      loadAll("refresh");
    });

    return () => {
      try {
        offTx?.();
        offGoals?.();
      } catch {}
    };
  }, [householdId, loadAll]);

  async function onSetSchedule(mode: PayScheduleMode) {
    if (!userId || !householdId) return;
    try {
      setScheduleModeState(mode);

      await setPaySchedule({
        householdId,
        userId,
        mode,
        settings: { start_ymd: startYMD },
      });

      setCyclesLimit(10);
      setDetailOpen(false);
      setDetailCycle(null);
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

    await setPaySchedule({
      householdId,
      userId,
      mode: scheduleMode,
      settings: { start_ymd: newStart },
    });

    setStartYMD(newStart);
    setCyclesLimit(10);
    await loadAll("refresh");
  }

  function suggestedAllocations(netCents: number) {
    let remaining = Math.max(0, netCents);
    const next: Record<string, string> = {};

    for (const g of goals) {
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
      next[g.id] = centsToInput(put);
    }

    for (const g of goals) if (!(g.id in next)) next[g.id] = "";
    return next;
  }

  function allocTotalCents() {
    let total = 0;
    for (const gid of Object.keys(alloc)) total += Math.max(0, parseBRLToCents(alloc[gid]));
    return total;
  }

  const remainingCents = useMemo(() => {
    const net = Number(cycleNetCents ?? 0) || 0;
    const total = allocTotalCents();
    return Math.max(0, net - total);
  }, [cycleNetCents, alloc]);

  async function openDetail(cycle: PayCycle) {
    if (!householdId) return;

    setDetailOpen(true);
    setDetailCycle(cycle);
    setDetailLoading(true);
    setCycleNetCents(null);
    setAlloc({});
    setExistingAllocMap({});

    try {
      const closure = closuresMap[cycle.cycleKey];
      const isClosed = !!closure;

      if (isClosed) {
        const netSnap = Number(closure?.net_cents ?? 0) || 0;

        const contribMap = await listGoalContributionsForCycle({
          householdId,
          cycleKey: cycle.cycleKey,
        });

        setExistingAllocMap(contribMap);

        const nextAlloc: Record<string, string> = {};
        for (const g of goals) nextAlloc[g.id] = centsToInput(contribMap[g.id] ?? 0);

        setCycleNetCents(netSnap);
        setAlloc(nextAlloc);
        return;
      }

      const res: any = await (getNetBetween as any)(householdId, cycle.startYMD, cycle.endYMD);
      const net = Number(res?.net ?? 0) || 0;

      setCycleNetCents(net);
      setAlloc(suggestedAllocations(net));
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao abrir o ciclo.");
      setDetailOpen(false);
      setDetailCycle(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmCloseOrEdit() {
    if (!userId || !householdId || !detailCycle) return;
    if (savingDetail) return;

    const net = Number(cycleNetCents ?? 0) || 0;
    if (net <= 0) {
      return Alert.alert("Sem sobra", "Este ciclo não teve sobra positiva para distribuir.");
    }

    const total = allocTotalCents();
    if (total <= 0) return Alert.alert("Atenção", "Distribua um valor para pelo menos uma meta.");
    if (total > net) {
      return Alert.alert("Atenção", `Você distribuiu ${formatBRLFromCents(total)}, mas sobrou ${formatBRLFromCents(net)}.`);
    }

    try {
      setSavingDetail(true);

      // inclui metas que tinham valor antes (pra permitir zerar)
      const allocations = goals
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
        mode: detailCycle.mode,
        cycleKey: detailCycle.cycleKey,
        cycleStart: detailCycle.startYMD,
        cycleEnd: detailCycle.endYMD,
        netCents: net,
        allocations,
      });

      await loadAll("refresh");
      emitGoalsChanged({ householdId });

      Alert.alert("Pronto!", closureExists ? "Fechamento atualizado." : "Ciclo fechado e aportes aplicados.");
      setDetailOpen(false);
      setDetailCycle(null);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar fechamento.");
    } finally {
      setSavingDetail(false);
    }
  }

  return (
    <Screen>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <H1>Fechamentos</H1>
          <P muted>Feche ciclos e distribua a sobra entre suas metas.</P>
        </View>

        <Row style={{ gap: 10, alignItems: "center" }}>
          {refreshing ? <ActivityIndicator size="small" /> : null}
          <View style={ui.badge}>
            <Text style={ui.badgeText} numberOfLines={1}>
              Pendentes: {pendingCount}
            </Text>
          </View>
        </Row>
      </Row>

      <View style={{ height: 14 }} />

      {/* Ação rápida */}
      <Card intensity={18}>
        <Text style={ui.sectionTitle}>Ação rápida</Text>
        <View style={{ height: 10 }} />

        {initialLoading ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : oldestPending ? (
          <>
            <Text style={ui.mutedStrong}>
              Pendência mais antiga: {formatDateBRFromYMD(oldestPending.startYMD)} → {formatDateBRFromYMD(oldestPending.endYMD)}
            </Text>

            <View style={{ height: 10 }} />

            <Button
              title="Fechar pendência mais antiga"
              onPress={() => openDetail(oldestPending)}
              disabled={!goals.length}
            />

            {!goals.length ? (
              <P muted style={{ marginTop: 8 }}>
                Crie metas para conseguir distribuir a sobra.
              </P>
            ) : null}
          </>
        ) : (
          <P muted>Nenhuma pendência 🎉</P>
        )}
      </Card>

      <View style={{ height: 14 }} />

      {/* Configurações */}
      <Card intensity={18}>
        <Pressable onPress={() => setShowSettings((v) => !v)} style={{ paddingVertical: 2 }}>
          <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
            <Text style={ui.sectionTitle}>Configurações</Text>
            <Text style={ui.linkText}>{showSettings ? "Fechar" : "Abrir"}</Text>
          </Row>
          <P muted style={{ marginTop: 6 }}>Como você recebe e a partir de quando contar pendências.</P>
        </Pressable>

        {showSettings ? (
          <View style={{ marginTop: 14 }}>
            <Text style={ui.label}>Como você recebe?</Text>
            <P muted style={{ marginTop: 6 }}>Isso define os ciclos e os períodos disponíveis.</P>

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
                  title={scheduleMode === "twice_month" ? "✓ 2x/mês (15 + último útil)" : "2x/mês (15 + último útil)"}
                  onPress={() => onSetSchedule("twice_month")}
                />
              </View>
            </Row>

            <View style={{ height: 12 }} />

            <Text style={ui.mutedStrong}>
              Pendências contam a partir de: {formatDateBRFromYMD(startYMD)}
            </Text>

            <View style={{ height: 10 }} />
            <Button title="Incluir mês anterior" onPress={moveStartBackOneMonth} />
          </View>
        ) : null}
      </Card>

      <View style={{ height: 14 }} />

      {/* Ciclos */}
      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={ui.sectionTitle}>Ciclos</Text>
          <Pressable onPress={() => loadAll("refresh")} style={ui.linkBtn}>
            <Text style={ui.linkText}>Atualizar</Text>
          </Pressable>
        </Row>

        <View style={{ height: 12 }} />
        <SegmentedFilter value={filter} onChange={setFilter} />
        <View style={{ height: 12 }} />

        {initialLoading ? (
          <Row style={{ gap: 10 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : !filteredCycles.length ? (
          <P muted>Nenhum ciclo para mostrar neste filtro.</P>
        ) : (
          <View style={{ gap: 10 }}>
            {filteredCycles.map((c) => {
              const isClosed = !!closuresMap[c.cycleKey];
              return (
                <Pressable key={c.cycleKey} onPress={() => openDetail(c)} style={ui.cycleItem}>
                  <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={ui.cycleTitle}>
                        {formatDateBRFromYMD(c.startYMD)} → {formatDateBRFromYMD(c.endYMD)}
                      </Text>
                      <Text style={ui.cycleHint}>Toque para ver detalhes e distribuir a sobra</Text>
                    </View>

                    <View style={[ui.statusPill, isClosed ? ui.statusOk : ui.statusPending]}>
                      <Text style={[ui.statusText, { color: isClosed ? theme.colors.good : theme.colors.pink }]}>
                        {isClosed ? "Fechado" : "Pendente"}
                      </Text>
                    </View>
                  </Row>
                </Pressable>
              );
            })}

            <View style={{ height: 6 }} />
            <Button title="Carregar mais ciclos" onPress={() => setCyclesLimit((n) => n + 12)} />
          </View>
        )}
      </Card>

      {/* Modal detalhe */}
      <Modal visible={detailOpen} transparent animationType="fade" onRequestClose={() => setDetailOpen(false)}>
        <View style={ui.modalOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setDetailOpen(false)} />

          <View style={ui.sheet}>
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Text style={ui.sheetTitle}>Detalhe do ciclo</Text>
              <Pressable onPress={() => setDetailOpen(false)} style={ui.closeBtn} hitSlop={12}>
                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>×</Text>
              </Pressable>
            </Row>

            <View style={{ height: 10 }} />

            {detailCycle ? (
              <>
                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>
                  {formatDateBRFromYMD(detailCycle.startYMD)} → {formatDateBRFromYMD(detailCycle.endYMD)}
                </Text>

                <View style={{ height: 12 }} />

                {detailLoading || cycleNetCents === null ? (
                  <Row style={{ gap: 10 }}>
                    <ActivityIndicator />
                    <P muted>Carregando dados…</P>
                  </Row>
                ) : (
                  <>
                    {/* Resumo do ciclo */}
                    <View style={ui.sheetBox}>
                      <Row style={{ justifyContent: "space-between" }}>
                        <View>
                          <Text style={ui.mutedStrong}>Sobrou</Text>
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
                        </View>

                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={ui.mutedStrong}>Status</Text>
                          <Text
                            style={{
                              color: closureExists ? theme.colors.good : theme.colors.pink,
                              fontWeight: "900",
                              marginTop: 6,
                            }}
                          >
                            {closureExists ? "Fechado" : "Pendente"}
                          </Text>
                        </View>
                      </Row>

                      <View style={{ height: 12 }} />

                      <Row style={{ justifyContent: "space-between" }}>
                        <View>
                          <Text style={ui.mutedStrong}>Distribuído</Text>
                          <Text style={{ color: theme.colors.text, fontWeight: "900", marginTop: 6 }}>
                            {formatBRLFromCents(allocTotalCents())}
                          </Text>
                        </View>

                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={ui.mutedStrong}>Falta</Text>
                          <Text style={{ color: theme.colors.text, fontWeight: "900", marginTop: 6 }}>
                            {formatBRLFromCents(remainingCents)}
                          </Text>
                        </View>
                      </Row>
                    </View>

                    {cycleNetCents <= 0 ? (
                      <P muted style={{ marginTop: 12 }}>
                        Não há sobra positiva neste ciclo — nada para distribuir.
                      </P>
                    ) : (
                      <>
                        <View style={{ height: 12 }} />

                        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={ui.sheetSectionTitle}>Distribuir nas metas</Text>

                          <Row style={{ gap: 10 }}>
                            <Pressable
                              onPress={() => setAlloc(suggestedAllocations(Math.max(0, cycleNetCents)))}
                              disabled={savingDetail}
                              style={ui.smallLink}
                            >
                              <Text style={ui.linkText}>Sugerir</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => {
                                const z: Record<string, string> = {};
                                for (const g of goals) z[g.id] = "";
                                setAlloc(z);
                              }}
                              disabled={savingDetail}
                              style={ui.smallLink}
                            >
                              <Text style={ui.linkText}>Zerar</Text>
                            </Pressable>
                          </Row>
                        </Row>

                        <View style={{ height: 10 }} />

                        <ScrollView
                          style={{ maxHeight: 320 }}
                          contentContainerStyle={{ paddingBottom: 12 }}
                          showsVerticalScrollIndicator={false}
                        >
                          {goals.map((g, idx) => (
                            <View
                              key={g.id}
                              style={[
                                ui.goalLine,
                                idx === 0 ? { borderTopWidth: 0, paddingTop: 0, marginTop: 0 } : null,
                              ]}
                            >
                              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                                <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{g.title}</Text>
                                <Text style={{ color: theme.colors.muted, fontWeight: "800" }}>
                                  {formatBRLFromCents(g.current_cents)} / {formatBRLFromCents(g.target_cents)}
                                </Text>
                              </Row>

                              <View style={{ height: 10 }} />

                              <Text style={ui.label}>Valor</Text>
                              <View style={{ height: 8 }} />

                              <TextInput
                                value={alloc[g.id] ?? ""}
                                onChangeText={(t) => setAlloc((prev) => ({ ...prev, [g.id]: normalizeMoneyBR(t) }))}
                                placeholder="0,00"
                                placeholderTextColor={"rgba(231,234,243,0.40)"}
                                keyboardType="decimal-pad"
                                style={ui.inputLine}
                              />
                            </View>
                          ))}
                        </ScrollView>

                        <View style={{ height: 12 }} />

                        <Row style={{ gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Button
                              title={savingDetail ? "Salvando..." : closureExists ? "Salvar edição" : "Confirmar fechamento"}
                              onPress={confirmCloseOrEdit}
                              disabled={savingDetail}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Button title="Fechar" onPress={() => setDetailOpen(false)} disabled={savingDetail} />
                          </View>
                        </Row>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <P muted>Nenhum ciclo selecionado.</P>
            )}
          </View>

          <Pressable style={{ flex: 1 }} onPress={() => setDetailOpen(false)} />
        </View>
      </Modal>
    </Screen>
  );
}

const ui = StyleSheet.create({
  sectionTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  sheetTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  sheetSectionTitle: { color: theme.colors.text, fontWeight: "900", fontSize: 14 },

  mutedStrong: { color: theme.colors.muted, fontWeight: "800" },

  badge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    maxWidth: 150,
  },
  badgeText: { color: theme.colors.text, fontWeight: "900" },

  linkBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  linkText: { color: theme.colors.primary, fontWeight: "900" },
  smallLink: { paddingVertical: 6, paddingHorizontal: 6 },

  label: { color: "rgba(231,234,243,0.85)", fontWeight: "900", fontSize: 13 },
  inputLine: {
    height: 44,
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 16,
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },

  cycleItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  cycleTitle: { color: theme.colors.text, fontWeight: "900" },
  cycleHint: { color: theme.colors.muted, fontWeight: "800", marginTop: 6 },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusOk: {
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  statusPending: {
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  statusText: { fontWeight: "900" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "84%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: theme.colors.bg1,
    padding: 14,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },

  sheetBox: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 18,
    padding: 14,
  },

  goalLine: {
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
  },
});