// app/(tabs)/goals.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from "react-native";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Input, Label, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addMonths, ymd } from "../../src/lib/date";
import { parseBRLToCents, formatBRLFromCents, formatDateBRFromYMD, formatBRLInputFromDigits } from "../../src/lib/format";
import { addGoal, listGoals, Goal } from "../../src/lib/goals";
import { emitGoalsChanged, onGoalsChanged } from "../../src/lib/bus";
import { supabase } from "../../src/lib/supabase";

// ✅ aceita ponto e converte pra vírgula (pt-BR), 2 casas
function desiredDateFromMonths(m: string) {
  const months = Math.max(1, Number(m || "12"));
  return ymd(addMonths(new Date(), months));
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function ProgressBar({ value }: { value: number }) {
  const v = clamp01(value);
  return (
    <View
      style={{
        height: 8,
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.08)",
        overflow: "hidden",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${Math.round(v * 100)}%`,
          backgroundColor: theme.colors.primary,
          borderRadius: 999,
        }}
      />
    </View>
  );
}

// DD/MM/AAAA -> YYYY-MM-DD (retorna null se inválido)
function dateBRToYMD(s: string) {
  const t = String(s || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  if (!yy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const d = new Date(yy, mm - 1, dd);
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return ymd(d);
}

// máscara simples: DD/MM/AAAA
function normalizeDateBR(text: string) {
  const digits = String(text || "").replace(/\D/g, "").slice(0, 8);
  const a = digits.slice(0, 2);
  const b = digits.slice(2, 4);
  const c = digits.slice(4, 8);
  let out = a;
  if (b.length) out += `/${b}`;
  if (c.length) out += `/${c}`;
  return out;
}

export default function GoalsTab() {
  const { userId } = useSession();
  const { householdId, loading: hhLoading } = useHouseholdId(userId);

  const [busy, setBusy] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);

  // ✅ modal nova meta
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [months, setMonths] = useState("12");
  const previewCents = useMemo(() => parseBRLToCents(value), [value]);

  // ✅ modal detalhes/editar/excluir
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalSel, setGoalSel] = useState<Goal | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editDateBR, setEditDateBR] = useState(""); // DD/MM/AAAA
  const [savingGoal, setSavingGoal] = useState(false);
  const [deletingGoal, setDeletingGoal] = useState(false);

  const goalsSorted = useMemo(() => {
    const arr = [...(goals ?? [])];
    arr.sort((a: any, b: any) => String(a.desired_date || "").localeCompare(String(b.desired_date || "")));
    return arr;
  }, [goals]);

  const loadGoals = useCallback(async () => {
    if (!householdId) return;
    try {
      setBusy(true);
      const g = await listGoals(householdId);
      setGoals(g);
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao carregar metas.");
    } finally {
      setBusy(false);
    }
  }, [householdId]);

  useEffect(() => {
    if (!hhLoading && householdId) loadGoals();
  }, [hhLoading, householdId, loadGoals]);

  useEffect(() => {
    if (!householdId) return;
    const off = onGoalsChanged?.((ev: any) => {
      if (!ev?.householdId || ev.householdId !== householdId) return;
      loadGoals();
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [householdId, loadGoals]);

  async function onAdd() {
    if (!userId || !householdId) return;
    if (saving) return;

    const t = title.trim();
    const cents = parseBRLToCents(value);
    if (!t) return Alert.alert("Atenção", "Digite um título.");
    if (cents <= 0) return Alert.alert("Atenção", "Digite um valor válido.");

    try {
      setSaving(true);
      await addGoal({
        householdId,
        userId,
        title: t,
        target_cents: cents,
        desired_date: desiredDateFromMonths(months),
      });

      setTitle("");
      setValue("");
      setMonths("12");
      setShowAddModal(false);

      await loadGoals();
      emitGoalsChanged({ householdId });
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao adicionar meta.");
    } finally {
      setSaving(false);
    }
  }

  function openGoalDetails(g: Goal) {
    const gg: any = g as any;
    setGoalSel(g);
    setEditTitle(String(gg.title ?? ""));
    setEditValue(formatBRLFromCents(Number(gg.target_cents ?? 0) || 0));

    const y = String(gg.desired_date ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(y)) {
      const [yy, mm, dd] = y.split("-");
      setEditDateBR(`${dd}/${mm}/${yy}`);
    } else setEditDateBR("");

    setShowGoalModal(true);
  }

  async function saveGoalEdits() {
    if (!householdId || !goalSel) return;
    if (savingGoal) return;

    const newTitle = editTitle.trim();
    const newTarget = parseBRLToCents(editValue);
    const newDesiredYMD = dateBRToYMD(editDateBR);

    if (!newTitle) return Alert.alert("Atenção", "Digite um título.");
    if (newTarget <= 0) return Alert.alert("Atenção", "Digite um valor válido.");
    if (!newDesiredYMD) return Alert.alert("Atenção", "Digite um prazo válido (DD/MM/AAAA).");

    try {
      setSavingGoal(true);
      const { error } = await supabase
        .from("goals")
        .update({ title: newTitle, target_cents: newTarget, desired_date: newDesiredYMD })
        .eq("household_id", householdId)
        .eq("id", goalSel.id);

      if (error) throw error;

      setShowGoalModal(false);
      setGoalSel(null);

      await loadGoals();
      emitGoalsChanged({ householdId });
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar alterações.");
    } finally {
      setSavingGoal(false);
    }
  }

  async function deleteGoalNow() {
    if (!householdId || !goalSel) return;
    if (deletingGoal) return;

    Alert.alert("Excluir meta", "Tem certeza? Essa ação não pode ser desfeita.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          try {
            setDeletingGoal(true);

            const { error } = await supabase
              .from("goals")
              .delete()
              .eq("household_id", householdId)
              .eq("id", goalSel.id);

            if (error) throw error;

            setShowGoalModal(false);
            setGoalSel(null);

            await loadGoals();
            emitGoalsChanged({ householdId });
          } catch (e: any) {
            Alert.alert("Erro", e?.message ?? "Falha ao excluir meta.");
          } finally {
            setDeletingGoal(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <AppHeader title="Metas" subtitle="Crie metas e acompanhe o progresso" />

      {/* Lista */}
      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>Suas metas</Text>
          <Text style={{ color: theme.colors.muted, fontWeight: "900" }}>{goals.length}</Text>
        </Row>

        <View style={{ height: 10 }} />
        <Button title="Criar nova meta" onPress={() => setShowAddModal(true)} />
        <View style={{ height: 4 }} />

        {busy ? (
          <Row style={{ gap: 10, paddingVertical: 8 }}>
            <ActivityIndicator />
            <P muted>Carregando…</P>
          </Row>
        ) : !goals.length ? (
          <View style={{ paddingTop: 8 }}>
            <P muted>Você ainda não tem metas.</P>
          </View>
        ) : (
          <View>
            {goalsSorted.map((g: any, idx: number) => {
              const current = Number(g.current_cents ?? 0) || 0;
              const target = Math.max(1, Number(g.target_cents ?? 1) || 1);
              const progress = current / target;

              return (
                <Pressable
                  key={g.id}
                  onPress={() => openGoalDetails(g)}
                  style={{
                    paddingVertical: 12,
                    borderTopWidth: idx === 0 ? 0 : 1,
                    borderTopColor: theme.colors.border,
                  }}
                >
                  <Row style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: "900" }}>{g.title}</Text>

                      <Text style={{ color: theme.colors.muted, fontWeight: "800", marginTop: 4 }}>
                        {formatBRLFromCents(current)}{" "}
                        <Text style={{ color: theme.colors.muted2, fontWeight: "800" }}>/</Text>{" "}
                        {formatBRLFromCents(target)}
                      </Text>

                      <View style={{ height: 10 }} />
                      <ProgressBar value={progress} />
                    </View>

                    <Text style={{ color: theme.colors.muted, fontWeight: "900" }}>
                      {Math.round(clamp01(progress) * 100)}%
                    </Text>
                  </Row>

                  <Text style={{ color: theme.colors.muted2, fontWeight: "800", marginTop: 8 }}>
                    Prazo: {formatDateBRFromYMD(g.desired_date)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </Card>

      {/* MODAL NOVA META */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) setShowAddModal(false);
        }}
      >
        <Pressable
          onPress={() => (!saving ? setShowAddModal(false) : null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.10)",
              backgroundColor: theme.colors.bg1,
              overflow: "hidden",
            }}
          >
            <View style={{ padding: 14 }}>
              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>Nova meta</Text>
                <Pressable onPress={() => (!saving ? setShowAddModal(false) : null)} hitSlop={10}>
                  <Text style={{ color: theme.colors.muted, fontWeight: "900", fontSize: 18 }}>×</Text>
                </Pressable>
              </Row>

              <View style={{ height: 12 }} />

              <Label>Título</Label>
              <Input value={title} onChangeText={setTitle} placeholder="Ex: Reserva, Viagem, Carro..." />

              <View style={{ height: 10 }} />
              <Label>Valor (R$)</Label>
              <Input
                value={value}
                onChangeText={(t) => setValue(formatBRLInputFromDigits(t))}
                placeholder="Ex: 5.000,00"
                keyboardType="number-pad"
              />
              <P muted>Prévia: {formatBRLFromCents(previewCents)}</P>

              <View style={{ height: 10 }} />
              <Label>Prazo desejado (meses)</Label>
              <Input
                value={months}
                onChangeText={(t) => setMonths(t.replace(/\D/g, ""))}
                placeholder="Ex: 12"
                keyboardType="numeric"
              />
              <P muted>Data estimada: {formatDateBRFromYMD(desiredDateFromMonths(months))}</P>

              <View style={{ height: 12 }} />
              <Button title={saving ? "Adicionando..." : "Criar meta"} onPress={onAdd} disabled={saving} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MODAL DETALHES */}
      <Modal
        visible={showGoalModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!savingGoal && !deletingGoal) setShowGoalModal(false);
        }}
      >
        <Pressable
          onPress={() => (!savingGoal && !deletingGoal ? setShowGoalModal(false) : null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: 16, justifyContent: "center" }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.10)",
              backgroundColor: theme.colors.bg1,
              overflow: "hidden",
              maxHeight: "85%",
              width: "100%",
              maxWidth: 520,
              alignSelf: "center",
            }}
          >
            <View style={{ padding: 14 }}>
              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 16 }}>
                  {goalSel?.title ?? "Detalhes"}
                </Text>
                <Pressable onPress={() => (!savingGoal && !deletingGoal ? setShowGoalModal(false) : null)} hitSlop={10}>
                  <Text style={{ color: theme.colors.muted, fontWeight: "900", fontSize: 18 }}>×</Text>
                </Pressable>
              </Row>

              <View style={{ height: 12 }} />

              <Label>Título</Label>
              <Input value={editTitle} onChangeText={setEditTitle} placeholder="Ex: Reserva, Viagem..." />

              <View style={{ height: 10 }} />
              <Label>Valor alvo (R$)</Label>
              <Input
                value={editValue}
                onChangeText={(t) => setEditValue(formatBRLInputFromDigits(t))}
                placeholder="Ex: 8.000,00"
                keyboardType="number-pad"
              />
              <P muted>Prévia: {formatBRLFromCents(parseBRLToCents(editValue))}</P>

              <View style={{ height: 10 }} />
              <Label>Prazo (DD/MM/AAAA)</Label>
              <Input
                value={editDateBR}
                onChangeText={(t) => setEditDateBR(normalizeDateBR(t))}
                placeholder="Ex: 15/12/2026"
                keyboardType="numeric"
              />
              <P muted>Atual: {goalSel?.desired_date ? formatDateBRFromYMD((goalSel as any).desired_date) : "—"}</P>

              <View style={{ height: 12 }} />

              <Row style={{ gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button title={savingGoal ? "Salvando..." : "Salvar"} onPress={saveGoalEdits} disabled={savingGoal || deletingGoal} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title={deletingGoal ? "Excluindo..." : "Excluir"} onPress={deleteGoalNow} disabled={savingGoal || deletingGoal} />
                </View>
              </Row>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
