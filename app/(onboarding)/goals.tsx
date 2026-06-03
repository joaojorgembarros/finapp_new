// app/(onboarding)/goals.tsx
import React, { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import Screen from "../../src/ui/Screen";
import { Button, Card, H1, Input, Label, P, Pill, Row } from "../../src/ui/components";
import { parseBRLToCents, formatBRLFromCents, formatBRLInputFromDigits } from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { getMyHouseholdId } from "../../src/lib/household";
import { upsertGoals } from "../../src/lib/goals";
import { upsertProfile } from "../../src/lib/profile";
import { addMonths, ymd } from "../../src/lib/date";

type GoalDraft = { title: string; value: string; months: string };

function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

function monthlyNeeded(valueCents: number, months: string) {
  const m = Math.max(1, Number(months || "1"));
  return Math.ceil(valueCents / m);
}

function GoalCard({
  idx,
  draft,
  required,
  onChange,
}: {
  idx: number;
  draft: GoalDraft;
  required?: boolean;
  onChange: (next: GoalDraft) => void;
}) {
  const previewCents = parseBRLToCents(draft.value);
  const monthly = monthlyNeeded(previewCents, draft.months);

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", gap: 10 }}>
        <P muted>{required ? "Meta principal" : `Meta extra ${idx - 1}`}</P>
        {required ? <Pill text="importante" tone="good" /> : <Pill text="opcional" />}
      </Row>

      <Label>Nome da meta</Label>
      <Input
        value={draft.title}
        onChangeText={(t) => onChange({ ...draft, title: t })}
        placeholder="Ex: Reserva de emergencia"
      />

      <Label>Valor desejado (R$)</Label>
      <Input
        value={draft.value}
        onChangeText={(t) => onChange({ ...draft, value: formatBRLInputFromDigits(t) })}
        placeholder="R$ 0,00"
        keyboardType="numeric"
      />
      <P muted>Prévia: {formatBRLFromCents(previewCents)}</P>

      <Label>Prazo desejado (meses)</Label>
      <Input
        value={draft.months}
        onChangeText={(t) => onChange({ ...draft, months: onlyDigits(t).slice(0, 3) })}
        placeholder="Ex: 12"
        keyboardType="number-pad"
      />

      {previewCents > 0 ? (
        <P muted>Para chegar lá nesse prazo: cerca de {formatBRLFromCents(monthly)} por mês.</P>
      ) : null}
    </Card>
  );
}

export default function GoalsOnboarding() {
  const { userId } = useSession();
  const [busy, setBusy] = useState(false);

  const [g1, setG1] = useState<GoalDraft>({
    title: "Reserva de emergencia",
    value: "",
    months: "12",
  });
  const [g2, setG2] = useState<GoalDraft>({
    title: "",
    value: "",
    months: "10",
  });
  const [g3, setG3] = useState<GoalDraft>({
    title: "",
    value: "",
    months: "8",
  });

  const totalTargets = useMemo(
    () => parseBRLToCents(g1.value) + parseBRLToCents(g2.value) + parseBRLToCents(g3.value),
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

    const drafts = [g1, g2, g3];
    const goals = drafts
      .map((g, idx) => ({
        title: g.title.trim(),
        target_cents: parseBRLToCents(g.value),
        desired_date: desiredDateFromMonths(g.months),
        priority: idx + 1,
      }))
      .filter((g, idx) => idx === 0 || g.title || g.target_cents > 0);

    const main = goals[0];
    if (!main?.title || main.target_cents <= 0) {
      return Alert.alert("Atenção", "Preencha pelo menos a meta principal com nome e valor.");
    }

    if (goals.some((g) => !g.title || g.target_cents <= 0)) {
      return Alert.alert("Atenção", "Nas metas extras, preencha nome e valor ou deixe tudo em branco.");
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
      <H1>Escolha uma meta</H1>
      <P muted>
        Sem meta, o dinheiro só vai vivendo a própria vida. Com uma meta, o app mostra quanto falta, quanto guardar por mês e se os gastos estão ajudando ou atrapalhando.
      </P>

      <Card intensity={18}>
        <Row style={{ justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <P muted>Total planejado</P>
            <P style={{ fontWeight: "900" }}>{formatBRLFromCents(totalTargets)}</P>
          </View>
          <Pill text="alvo" tone="good" />
        </Row>
      </Card>

      <GoalCard idx={1} draft={g1} required onChange={setG1} />
      <GoalCard idx={2} draft={g2} onChange={setG2} />
      <GoalCard idx={3} draft={g3} onChange={setG3} />

      <Button title={busy ? "Finalizando..." : "Entrar no app"} onPress={onFinish} disabled={busy} />
    </Screen>
  );
}
