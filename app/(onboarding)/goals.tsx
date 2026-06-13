// app/(onboarding)/goals.tsx
import React, { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, Input, Label, P } from "../../src/ui/components";
import { parseBRLToCents, formatBRLFromCents, formatBRLInputFromDigits } from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { getMyHouseholdId } from "../../src/lib/household";
import { upsertGoals } from "../../src/lib/goals";
import { upsertProfile } from "../../src/lib/profile";
import { addMonths, ymd } from "../../src/lib/date";

type GoalDraft = { title: string; value: string; months: string };

// ✅ mesmo normalizador (ponto -> vírgula, 2 casas)
function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

function createGoalDraft(index: number): GoalDraft {
  return {
    title: index === 0 ? "Reserva de emergencia" : "",
    value: "",
    months: "12",
  };
}

// ✅ IMPORTANTE: componente fora do GoalsOnboarding (não remonta a cada tecla)
function GoalCard({
  idx,
  draft,
  onChange,
  onRemove,
  previewCents,
}: {
  idx: number;
  draft: GoalDraft;
  onChange: (next: GoalDraft) => void;
  onRemove?: () => void;
  previewCents: number;
}) {
  return (
    <Card>
      <P muted>Meta {idx}</P>

      <Label>Título</Label>
      <Input
        value={draft.title}
        onChangeText={(t) => onChange({ ...draft, title: t })}
        placeholder="Ex: Reserva de emergência"
      />

      <Label>Valor (R$)</Label>
      <Input
        value={draft.value}
        onChangeText={(t) => onChange({ ...draft, value: formatBRLInputFromDigits(t) })}
        placeholder="Ex: 5000,00"
        keyboardType="number-pad"
      />
      <P muted>Prévia: {formatBRLFromCents(previewCents)}</P>

      <Label>Prazo desejado (meses)</Label>
      <Input
        value={draft.months}
        onChangeText={(t) => onChange({ ...draft, months: onlyDigits(t).slice(0, 3) })}
        placeholder="Ex: 12"
        keyboardType="number-pad"
      />

      {onRemove ? <Button title="Remover meta" variant="ghost" onPress={onRemove} /> : null}
    </Card>
  );
}

export default function GoalsOnboarding() {
  const { userId } = useSession();
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<GoalDraft[]>(() => [createGoalDraft(0)]);

  const preview = useMemo(
    () => drafts.map((draft) => parseBRLToCents(draft.value)),
    [drafts]
  );

  function updateDraft(index: number, next: GoalDraft) {
    setDrafts((prev) => prev.map((draft, i) => (i === index ? next : draft)));
  }

  function addDraft() {
    setDrafts((prev) => [...prev, createGoalDraft(prev.length)]);
  }

  function removeDraft(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function desiredDateFromMonths(m: string) {
    const months = Math.max(1, Number(m || "12"));
    return ymd(addMonths(new Date(), months));
  }

  async function onFinish() {
    if (!userId) return;

    const hh = await getMyHouseholdId(userId);
    if (!hh) return Alert.alert("Ops", "Crie um plano antes.");

    const goals = drafts
      .map((draft, index) => ({
        title: draft.title.trim(),
        target_cents: parseBRLToCents(draft.value),
        desired_date: desiredDateFromMonths(draft.months),
        priority: index + 1,
      }))
      .filter((goal) => goal.title || goal.target_cents > 0);

    if (!goals.length || !goals[0].title || goals[0].target_cents <= 0) {
      return Alert.alert("Atencao", "Preencha pelo menos a primeira meta com titulo e valor.");
    }

    if (goals.some((g) => !g.title || g.target_cents <= 0)) {
      return Alert.alert("Atencao", "Complete as metas extras ou remova as que estiverem vazias.");
    }

    try {
      setBusy(true);
      await upsertGoals(hh, userId, goals);
      await upsertProfile(userId, { onboarding_done: true });
      router.replace("/(tabs)/home");
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao salvar metas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen contentTopOffset={28}>
      <View style={{ alignItems: "center", marginBottom: 6 }}>
        <H1 style={{ textAlign: "center" }}>Sua meta</H1>
        <P muted style={{ textAlign: "center", marginTop: 8 }}>
          Comece com uma meta principal. Se quiser, adicione outras agora.
        </P>
      </View>

      {drafts.map((draft, index) => (
        <GoalCard
          key={index}
          idx={index + 1}
          draft={draft}
          onChange={(next) => updateDraft(index, next)}
          onRemove={index > 0 ? () => removeDraft(index) : undefined}
          previewCents={preview[index] ?? 0}
        />
      ))}

      <Button title="Adicionar outra meta" variant="ghost" onPress={addDraft} disabled={busy} />
      <Button title={busy ? "Finalizando..." : "Concluir"} onPress={onFinish} disabled={busy} />
    </Screen>
  );
}
