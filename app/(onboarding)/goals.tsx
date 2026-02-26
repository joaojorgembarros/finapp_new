// app/(onboarding)/goals.tsx
import React, { useMemo, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, Input, Label, P } from "../../src/ui/components";
import { parseBRLToCents, formatBRLFromCents } from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { getMyHouseholdId } from "../../src/lib/household";
import { upsertGoals } from "../../src/lib/goals";
import { upsertProfile } from "../../src/lib/profile";
import { addMonths, ymd } from "../../src/lib/date";

type GoalDraft = { title: string; value: string; months: string };

// ✅ mesmo normalizador (ponto -> vírgula, 2 casas)
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

function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

// ✅ IMPORTANTE: componente fora do GoalsOnboarding (não remonta a cada tecla)
function GoalCard({
  idx,
  draft,
  onChange,
  previewCents,
}: {
  idx: number;
  draft: GoalDraft;
  onChange: (next: GoalDraft) => void;
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
        onChangeText={(t) => onChange({ ...draft, value: normalizeMoneyBR(t) })}
        placeholder="Ex: 5000,00"
        keyboardType="decimal-pad"
      />
      <P muted>Prévia: {formatBRLFromCents(previewCents)}</P>

      <Label>Prazo desejado (meses)</Label>
      <Input
        value={draft.months}
        onChangeText={(t) => onChange({ ...draft, months: onlyDigits(t).slice(0, 3) })}
        placeholder="Ex: 12"
        keyboardType="number-pad"
      />
    </Card>
  );
}

export default function GoalsOnboarding() {
  const { userId } = useSession();
  const [busy, setBusy] = useState(false);

  const [g1, setG1] = useState<GoalDraft>({
    title: "Reserva de emergência",
    value: "",
    months: "12",
  });
  const [g2, setG2] = useState<GoalDraft>({
    title: "Viagem",
    value: "",
    months: "10",
  });
  const [g3, setG3] = useState<GoalDraft>({
    title: "Novo PC",
    value: "",
    months: "8",
  });

  const preview = useMemo(
    () => ({
      a: parseBRLToCents(g1.value),
      b: parseBRLToCents(g2.value),
      c: parseBRLToCents(g3.value),
    }),
    [g1.value, g2.value, g3.value]
  );

  function desiredDateFromMonths(m: string) {
    const months = Math.max(1, Number(m || "12"));
    return ymd(addMonths(new Date(), months));
  }

  async function onFinish() {
    if (!userId) return;

    const hh = await getMyHouseholdId(userId);
    if (!hh) return Alert.alert("Ops", "Crie um plano antes.");

    const goals = [
      {
        title: g1.title.trim(),
        target_cents: parseBRLToCents(g1.value),
        desired_date: desiredDateFromMonths(g1.months),
        priority: 1,
      },
      {
        title: g2.title.trim(),
        target_cents: parseBRLToCents(g2.value),
        desired_date: desiredDateFromMonths(g2.months),
        priority: 2,
      },
      {
        title: g3.title.trim(),
        target_cents: parseBRLToCents(g3.value),
        desired_date: desiredDateFromMonths(g3.months),
        priority: 3,
      },
    ];

    if (goals.some((g) => !g.title || g.target_cents <= 0)) {
      return Alert.alert("Atenção", "Preencha título e valor das 3 metas.");
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
    <Screen>
      <H1>Suas 3 metas</H1>
      <P muted>Isso vira o coração do app: estimativa de quando você chega lá.</P>

      <GoalCard idx={1} draft={g1} onChange={setG1} previewCents={preview.a} />
      <GoalCard idx={2} draft={g2} onChange={setG2} previewCents={preview.b} />
      <GoalCard idx={3} draft={g3} onChange={setG3} previewCents={preview.c} />

      <Button title={busy ? "Finalizando..." : "Concluir"} onPress={onFinish} disabled={busy} />
    </Screen>
  );
}
