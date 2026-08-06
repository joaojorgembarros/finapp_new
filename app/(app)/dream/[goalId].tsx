import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useHouseholdId } from "../../../src/hooks/useHousehold";
import { useKeyboardAwareScroll } from "../../../src/hooks/useKeyboardAwareScroll";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../../src/lib/format";
import {
  addGoalContribution,
  getGoalWithProgress,
  getSignedGoalPhotoUrl,
  GoalContribution,
  GoalProgress,
  listGoalContributions,
  updateGoalDetails,
} from "../../../src/lib/goals";
import { supabase } from "../../../src/lib/supabase";
import { useSession } from "../../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../../src/ui/OnboardingKit";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function progressLabel(progress: number) {
  const value = clampProgress(progress);
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

function toDate(value: string | null | undefined) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return toDate(value).toLocaleDateString("pt-BR");
}

function futureDefaultDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date;
}

function base64ToBytes(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes: number[] = [];

  for (let index = 0; index < clean.length; index += 4) {
    const a = chars.indexOf(clean[index] ?? "A");
    const b = chars.indexOf(clean[index + 1] ?? "A");
    const c = clean[index + 2] === "=" ? -1 : chars.indexOf(clean[index + 2] ?? "A");
    const d = clean[index + 3] === "=" ? -1 : chars.indexOf(clean[index + 3] ?? "A");
    const chunk = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);

    bytes.push((chunk >> 16) & 255);
    if (c >= 0) bytes.push((chunk >> 8) & 255);
    if (d >= 0) bytes.push(chunk & 255);
  }

  return bytes;
}

function imageExtension(mimeType?: string | null) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  return null;
}

type PickedPhoto = {
  uri: string;
  fileSize?: number | null;
  mimeType?: string | null;
};

async function selectDreamPhoto(): Promise<PickedPhoto | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset ? { uri: asset.uri, fileSize: asset.size, mimeType: asset.mimeType } : null;
}

function calendarCells(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return cells;
}

function deadlineMetrics(goal: GoalProgress | null, desiredDate: string | null) {
  const remainingCents = Math.max((goal?.target_cents ?? 0) - (goal?.contributed_cents ?? 0), 0);
  if (!desiredDate || !remainingCents) {
    return { remainingCents, days: null, months: null, monthlyCents: remainingCents ? null : 0 };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = toDate(desiredDate);
  deadline.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.ceil((deadline.getTime() - today.getTime()) / 86_400_000));
  const months = Math.max(1, Math.ceil(days / 30.4375));
  return { remainingCents, days, months, monthlyCents: Math.ceil(remainingCents / months) };
}

export default function DreamDetailsScreen() {
  const params = useLocalSearchParams<{ goalId?: string | string[] }>();
  const goalId = Array.isArray(params.goalId) ? params.goalId[0] : params.goalId;
  const { userId } = useSession();
  const { householdId, loading: householdLoading } = useHouseholdId(userId);
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } = useKeyboardAwareScroll<"motivation" | "contribution">();

  const [goal, setGoal] = useState<GoalProgress | null>(null);
  const [contributions, setContributions] = useState<GoalContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingContribution, setSavingContribution] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [motivation, setMotivation] = useState("");
  const [desiredDate, setDesiredDate] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!householdId || !goalId) {
      if (!householdLoading) setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [nextGoal, nextContributions] = await Promise.all([
        getGoalWithProgress(householdId, goalId),
        listGoalContributions(goalId),
      ]);
      if (!nextGoal) {
        Alert.alert("Sonho não encontrado", "Este sonho não está mais disponível.", [
          { text: "Voltar", onPress: () => router.back() },
        ]);
        return;
      }
      setGoal(nextGoal);
      setContributions(nextContributions);
    } catch (error: any) {
      Alert.alert("Sonho", error?.message ?? "Não foi possível carregar os detalhes.");
    } finally {
      setLoading(false);
    }
  }, [goalId, householdId, householdLoading]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const loadedGoalId = goal?.id;
  const savedMotivation = goal?.motivation ?? "";
  const savedDesiredDate = goal?.desired_date ?? null;

  useEffect(() => {
    if (!loadedGoalId) return;
    setMotivation(savedMotivation);
    setDesiredDate(savedDesiredDate);
  }, [loadedGoalId, savedDesiredDate, savedMotivation]);

  const progress = goal ? clampProgress((goal.contributed_cents / Math.max(goal.target_cents, 1)) * 100) : 0;
  const completed = progress >= 100;
  const metrics = deadlineMetrics(goal, desiredDate);
  const amountCents = parseBRLToCents(amount);
  const contributionDays = useMemo(() => new Set(contributions.map((entry) => entry.contributed_on)), [contributions]);
  const cells = useMemo(() => calendarCells(visibleMonth), [visibleMonth]);
  const selectedContributions = useMemo(
    () => selectedDay ? contributions.filter((entry) => entry.contributed_on === selectedDay) : [],
    [contributions, selectedDay]
  );
  const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const canGoNextMonth = visibleMonth.getTime() < currentMonth.getTime();
  const detailsChanged = Boolean(goal) && (
    motivation.trim() !== (goal?.motivation ?? "") || desiredDate !== goal?.desired_date
  );

  async function saveDetails() {
    if (!householdId || !goal || savingDetails) return;
    try {
      setSavingDetails(true);
      await updateGoalDetails({
        householdId,
        goalId: goal.id,
        motivation: motivation.trim() || null,
        desiredDate,
      });
      setGoal((current) => current ? { ...current, motivation: motivation.trim() || null, desired_date: desiredDate } : current);
      Alert.alert("Sonho atualizado", "Motivação e prazo foram salvos.");
    } catch (error: any) {
      Alert.alert("Não foi possível salvar", error?.message ?? "Tente novamente em alguns instantes.");
    } finally {
      setSavingDetails(false);
    }
  }

  async function pickPhoto() {
    if (!householdId || !userId || !goal || uploadingPhoto) return;
    let asset: PickedPhoto | null;
    try {
      asset = await selectDreamPhoto();
    } catch (error: any) {
      return Alert.alert("Escolher foto", error?.message ?? "Não foi possível abrir suas fotos.");
    }
    if (!asset?.uri) return;
    if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
      return Alert.alert("Foto muito grande", "Escolha uma imagem de até 5 MB.");
    }

    const mimeType = asset.mimeType || "image/jpeg";
    const extension = imageExtension(mimeType);
    if (!extension) return Alert.alert("Formato não aceito", "Escolha uma foto JPG, PNG ou WebP.");

    let uploadedPath: string | null = null;
    try {
      setUploadingPhoto(true);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const bytes = new Uint8Array(base64ToBytes(base64));
      uploadedPath = `${householdId}/${userId}/${goal.id}/cover-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("goal-photos").upload(uploadedPath, bytes.buffer, {
        contentType: mimeType,
        upsert: false,
      });
      if (uploadError) throw uploadError;

      await updateGoalDetails({
        householdId,
        goalId: goal.id,
        motivation: motivation.trim() || null,
        desiredDate,
        coverPhotoPath: uploadedPath,
      });
      const signedUrl = await getSignedGoalPhotoUrl(uploadedPath);
      const previousPath = goal.cover_photo_path;
      setGoal((current) => current ? {
        ...current,
        motivation: motivation.trim() || null,
        desired_date: desiredDate,
        cover_photo_path: uploadedPath,
        cover_photo_url: signedUrl,
      } : current);
      if (previousPath && previousPath !== uploadedPath) {
        await supabase.storage.from("goal-photos").remove([previousPath]);
      }
    } catch (error: any) {
      if (uploadedPath) await supabase.storage.from("goal-photos").remove([uploadedPath]);
      Alert.alert("Não foi possível enviar", error?.message ?? "Tente novamente com outra foto.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function saveContribution() {
    if (!householdId || !userId || !goal || savingContribution || completed) return;
    if (!amountCents) return Alert.alert("Valor para o sonho", "Digite quanto você guardou para continuar.");
    if (amountCents > metrics.remainingCents) {
      return Alert.alert("Valor para o sonho", `Você pode adicionar até ${formatBRLFromCents(metrics.remainingCents)} para concluir este sonho.`);
    }

    try {
      setSavingContribution(true);
      await addGoalContribution({
        householdId,
        goalId: goal.id,
        userId,
        amount_cents: amountCents,
        note,
      });
      setAmount("");
      setNote("");
      setSelectedDay(toYmd(new Date()));
      setVisibleMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
      await load();
    } catch (error: any) {
      Alert.alert("Adicionar valor", error?.message ?? "Não foi possível adicionar esse valor ao sonho.");
    } finally {
      setSavingContribution(false);
    }
  }

  function changeDeadline(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setDatePickerOpen(false);
    if (event.type === "set" && date) setDesiredDate(toYmd(date));
  }

  function changeMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
    setSelectedDay(null);
  }

  if ((loading && !goal) || householdLoading) {
    return (
      <OnboardingShell light>
        <View style={styles.loadingScreen}><ActivityIndicator color={OB.primary} size="large" /><Text style={styles.loadingText}>Carregando seu sonho...</Text></View>
      </OnboardingShell>
    );
  }

  if (!goal) {
    return (
      <OnboardingShell light>
        <View style={styles.loadingScreen}><Ionicons name="alert-circle-outline" size={34} color={OB.support} /><Text style={styles.loadingText}>Sonho não encontrado.</Text><Pressable onPress={() => router.back()} style={styles.simpleBackButton}><Text style={styles.simpleBackText}>Voltar</Text></Pressable></View>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell light>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, { paddingBottom: 32 + keyboardInset }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          onScrollBeginDrag={cancelPendingScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerCard}>
            <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12} accessibilityRole="button" accessibilityLabel="Voltar">
              <Ionicons name="arrow-back" size={19} color="#fff" />
            </Pressable>
            <Text style={styles.headerEyebrow}>Detalhes do sonho</Text>
            <Text style={styles.headerTitle} numberOfLines={2}>{goal.title}</Text>
            <Text style={styles.headerSubtitle}>{completed ? "Uma conquista para celebrar e lembrar." : "Transforme motivação em um plano possível."}</Text>
          </View>

          <View style={styles.heroCard}>
            <Pressable onPress={() => void pickPhoto()} disabled={uploadingPhoto} style={({ pressed }) => [styles.polaroid, pressed && styles.pressed]}>
              <View style={styles.polaroidPhotoArea}>
                {goal.cover_photo_url ? (
                  <Image source={{ uri: goal.cover_photo_url }} style={styles.polaroidImage} resizeMode="contain" />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Ionicons name="image-outline" size={38} color={OB.primary} />
                    <Text style={styles.photoPlaceholderText}>Sua inspiração</Text>
                  </View>
                )}
                {uploadingPhoto ? <View style={styles.photoLoading}><ActivityIndicator color="#fff" /></View> : null}
              </View>
              <View style={styles.polaroidCaptionRow}>
                <Text style={styles.polaroidCaption}>{goal.cover_photo_url ? "Trocar foto" : "Adicionar foto"}</Text>
                <Ionicons name="camera-outline" size={17} color={OB.primary} />
              </View>
            </Pressable>

            <View style={styles.progressColumn}>
              <View style={styles.progressTop}>
                <Text style={styles.progressLabel}>Progresso atual</Text>
                <View style={[styles.progressBadge, completed && styles.progressBadgeCompleted]}>
                  <Text style={styles.progressBadgeText}>{progressLabel(progress)}</Text>
                </View>
              </View>
              <Text style={styles.progressValue}>{formatBRLFromCents(goal.contributed_cents)}</Text>
              <Text style={styles.progressTarget}>de {formatBRLFromCents(goal.target_cents)}</Text>
              <View style={styles.progressTrack}><View style={[styles.progressFill, completed && styles.progressFillCompleted, { width: `${progress}%` }]} /></View>
              <Text style={styles.remainingText}>{completed ? "Sonho realizado" : `Faltam ${formatBRLFromCents(metrics.remainingCents)}`}</Text>
            </View>
          </View>

          <View style={styles.card} onLayout={registerField("motivation")}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionIcon}><Ionicons name="heart-outline" size={20} color={OB.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Minha motivação</Text><Text style={styles.sectionSubtitle}>Por que você quer realizar este sonho?</Text></View>
            </View>
            <TextInput
              value={motivation}
              onChangeText={setMotivation}
              placeholder="Ex.: Quero proporcionar mais conforto para minha família..."
              placeholderTextColor={OB.support}
              multiline
              maxLength={1000}
              textAlignVertical="top"
              onFocus={() => focusField("motivation")}
              onPressIn={() => focusField("motivation")}
              style={styles.motivationInput}
            />
            <Text style={styles.characterCount}>{motivation.length}/1000</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionIcon}><Ionicons name="calendar-outline" size={20} color={OB.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Prazo e planejamento</Text><Text style={styles.sectionSubtitle}>Defina quando pretende realizar este sonho.</Text></View>
            </View>
            <Pressable onPress={() => setDatePickerOpen(true)} style={styles.deadlineButton}>
              <View style={styles.deadlineButtonIcon}><Ionicons name="flag-outline" size={20} color={OB.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.deadlineCaption}>Data desejada</Text><Text style={styles.deadlineValue}>{desiredDate ? formatDate(desiredDate) : "Definir prazo"}</Text></View>
              <Ionicons name="chevron-forward" size={18} color={OB.support} />
            </Pressable>
            {datePickerOpen ? (
              <View style={styles.datePickerWrap}>
                <DateTimePicker
                  value={desiredDate ? toDate(desiredDate) : futureDefaultDate()}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  minimumDate={new Date()}
                  onChange={changeDeadline}
                />
                {Platform.OS === "ios" ? <Pressable onPress={() => setDatePickerOpen(false)} style={styles.datePickerDone}><Text style={styles.datePickerDoneText}>Concluir</Text></Pressable> : null}
              </View>
            ) : null}
            {desiredDate ? <Pressable onPress={() => setDesiredDate(null)} style={styles.removeDeadline}><Text style={styles.removeDeadlineText}>Remover prazo</Text></Pressable> : null}

            <View style={styles.planGrid}>
              <View style={styles.planMetric}>
                <Text style={styles.planMetricLabel}>Tempo restante</Text>
                <Text style={styles.planMetricValue}>{completed ? "Concluído" : metrics.days === null ? "Sem prazo" : metrics.days === 0 ? "Hoje" : metrics.days < 60 ? `${metrics.days} dias` : `${metrics.months} meses`}</Text>
              </View>
              <View style={styles.planMetric}>
                <Text style={styles.planMetricLabel}>Guardar por mês</Text>
                <Text style={styles.planMetricValue}>{metrics.monthlyCents === null ? "Defina o prazo" : formatBRLFromCents(metrics.monthlyCents)}</Text>
              </View>
            </View>

            <Pressable onPress={() => void saveDetails()} disabled={!detailsChanged || savingDetails} style={[styles.saveDetailsButton, (!detailsChanged || savingDetails) && styles.buttonDisabled]}>
              {savingDetails ? <ActivityIndicator color="#fff" /> : <><Ionicons name="save-outline" size={18} color="#fff" /><Text style={styles.saveDetailsText}>Salvar motivação e prazo</Text></>}
            </Pressable>
          </View>

          {!completed ? (
            <View style={styles.card} onLayout={registerField("contribution")}>
              <View style={styles.sectionHeading}>
                <View style={styles.sectionIcon}><Ionicons name="add" size={20} color={OB.primary} /></View>
                <View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Adicionar valor</Text><Text style={styles.sectionSubtitle}>Informe quanto você guardou para este sonho.</Text></View>
              </View>
              <View>
                <Text style={styles.fieldLabel}>Valor</Text>
                <View style={styles.moneyInputWrap}><Text style={styles.moneyPrefix}>R$</Text><TextInput value={amount.replace("R$", "").trim()} onChangeText={(text) => setAmount(formatBRLInputFromDigits(text))} placeholder="0,00" placeholderTextColor={OB.support} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus onFocus={() => focusField("contribution")} onPressIn={() => focusField("contribution")} onSubmitEditing={Keyboard.dismiss} style={styles.moneyInput} /></View>
              </View>
              <View>
                <Text style={styles.fieldLabel}>Observação <Text style={styles.optionalLabel}>(opcional)</Text></Text>
                <TextInput value={note} onChangeText={setNote} placeholder="Ex.: reserva do salário" placeholderTextColor={OB.support} returnKeyType="done" onFocus={() => focusField("contribution")} onPressIn={() => focusField("contribution")} onSubmitEditing={Keyboard.dismiss} style={styles.noteInput} />
              </View>
              {amountCents > metrics.remainingCents ? <Text style={styles.amountError}>O valor ultrapassa o que falta para concluir.</Text> : null}
              <Pressable onPress={() => void saveContribution()} disabled={!amountCents || amountCents > metrics.remainingCents || savingContribution} style={[styles.contributionButton, (!amountCents || amountCents > metrics.remainingCents || savingContribution) && styles.buttonDisabled]}>
                {savingContribution ? <ActivityIndicator color="#fff" /> : <><Text style={styles.contributionButtonText}>Adicionar ao sonho</Text><Ionicons name="arrow-forward" size={18} color="#fff" /></>}
              </Pressable>
            </View>
          ) : null}

          <View style={styles.card}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionIcon}><Ionicons name="calendar-number-outline" size={20} color={OB.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Histórico do sonho</Text><Text style={styles.sectionSubtitle}>{contributions.length === 1 ? "1 valor adicionado" : `${contributions.length} valores adicionados`}</Text></View>
            </View>
            <View style={styles.calendarHeader}>
              <Pressable onPress={() => changeMonth(-1)} style={styles.calendarArrow}><Ionicons name="chevron-back" size={19} color={OB.primary} /></Pressable>
              <Text style={styles.calendarMonth}>{MONTHS[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</Text>
              <Pressable onPress={() => changeMonth(1)} disabled={!canGoNextMonth} style={[styles.calendarArrow, !canGoNextMonth && styles.calendarArrowDisabled]}><Ionicons name="chevron-forward" size={19} color={OB.primary} /></Pressable>
            </View>
            <View style={styles.weekRow}>{WEEKDAYS.map((weekday, index) => <Text key={`${weekday}-${index}`} style={styles.weekday}>{weekday}</Text>)}</View>
            <View style={styles.calendarGrid}>
              {cells.map((day, index) => {
                if (!day) return <View key={`empty-${index}`} style={styles.calendarCell} />;
                const dateKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const hasContribution = contributionDays.has(dateKey);
                const selected = selectedDay === dateKey;
                return (
                  <Pressable key={dateKey} onPress={() => setSelectedDay(dateKey)} style={styles.calendarCell}>
                    <View style={[styles.dayCircle, hasContribution && styles.dayCircleContribution, selected && styles.dayCircleSelected]}>
                      <Text style={[styles.dayText, hasContribution && styles.dayTextContribution, selected && styles.dayTextSelected]}>{day}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.calendarLegend}><View style={styles.legendDay}><Text style={styles.legendDayText}>12</Text></View><Text style={styles.calendarLegendText}>Dia com valor guardado</Text></View>

            {selectedDay ? (
              <View style={styles.selectedDayCard}>
                <Text style={styles.selectedDayTitle}>{formatDate(selectedDay)}</Text>
                {selectedContributions.length ? selectedContributions.map((entry) => (
                  <View key={entry.id} style={styles.historyRow}>
                    <View style={styles.historyIcon}><Ionicons name="arrow-up" size={17} color="#169B62" /></View>
                    <View style={{ flex: 1 }}><Text style={styles.historyAmount}>{formatBRLFromCents(entry.amount_cents)}</Text><Text style={styles.historyMeta}>{entry.note || "Sem observação"}</Text></View>
                  </View>
                )) : <Text style={styles.emptyDayText}>Nenhum valor foi adicionado neste dia.</Text>}
              </View>
            ) : (
              <Text style={styles.calendarHint}>Toque em um dia para ver os valores guardados.</Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: OB.offWhite },
  scroll: { padding: 20, gap: 16, paddingBottom: 32 },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: OB.offWhite },
  loadingText: { color: OB.support, fontSize: 13, fontWeight: "800" },
  simpleBackButton: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 11, backgroundColor: OB.primary },
  simpleBackText: { color: "#fff", fontWeight: "900" },
  headerCard: { minHeight: 140, borderRadius: 24, padding: 20, paddingRight: 60, justifyContent: "flex-end", backgroundColor: OB.primary },
  backButton: { position: "absolute", right: 14, top: 14, width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.20)" },
  headerEyebrow: { color: OB.textOnDarkMid, fontSize: 10, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase" },
  headerTitle: { color: "#fff", fontSize: 25, fontWeight: "900", lineHeight: 30, marginTop: 8 },
  headerSubtitle: { color: OB.textOnDarkMid, fontSize: 13, fontWeight: "700", lineHeight: 19, marginTop: 6 },
  heroCard: { borderRadius: 22, padding: 16, flexDirection: "row", alignItems: "center", gap: 18, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  polaroid: { width: 124, borderRadius: 20, padding: 8, paddingBottom: 11, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft, transform: [{ rotate: "-2deg" }], shadowColor: "#061936", shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  polaroidPhotoArea: { height: 104, borderRadius: 15, overflow: "hidden", backgroundColor: "#E9EEF5" },
  polaroidImage: { width: "100%", height: "100%" },
  photoPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 7 },
  photoPlaceholderText: { color: OB.support, fontSize: 9, fontWeight: "900" },
  photoLoading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(6,25,54,0.55)" },
  polaroidCaptionRow: { marginTop: 8, paddingHorizontal: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  polaroidCaption: { color: OB.primary, fontSize: 10, fontWeight: "900" },
  progressColumn: { flex: 1, minWidth: 0 },
  progressTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  progressLabel: { color: OB.support, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  progressBadge: { minWidth: 46, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6, alignItems: "center", backgroundColor: OB.primary },
  progressBadgeCompleted: { backgroundColor: "#169B62" },
  progressBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  progressValue: { color: OB.primary, fontSize: 21, fontWeight: "900", marginTop: 12 },
  progressTarget: { color: OB.support, fontSize: 11, fontWeight: "800", marginTop: 2 },
  progressTrack: { height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: OB.supportSoft, marginTop: 12 },
  progressFill: { height: "100%", borderRadius: 999, backgroundColor: OB.primary },
  progressFillCompleted: { backgroundColor: "#169B62" },
  remainingText: { color: OB.support, fontSize: 10, fontWeight: "900", marginTop: 8 },
  card: { borderRadius: 20, padding: 16, gap: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: OB.supportSoft },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 11 },
  sectionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: OB.offWhite },
  sectionTitle: { color: OB.primary, fontSize: 16, fontWeight: "900" },
  sectionSubtitle: { color: OB.support, fontSize: 11, fontWeight: "700", lineHeight: 15, marginTop: 3 },
  motivationInput: { minHeight: 112, borderRadius: 16, padding: 14, color: OB.primary, fontSize: 13, fontWeight: "700", lineHeight: 19, backgroundColor: OB.offWhite, borderWidth: 1, borderColor: OB.supportSoft },
  characterCount: { alignSelf: "flex-end", color: OB.support, fontSize: 9, fontWeight: "800", marginTop: -7 },
  deadlineButton: { minHeight: 62, borderRadius: 16, padding: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: OB.offWhite, borderWidth: 1, borderColor: OB.supportSoft },
  deadlineButtonIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  deadlineCaption: { color: OB.support, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  deadlineValue: { color: OB.primary, fontSize: 14, fontWeight: "900", marginTop: 3 },
  datePickerWrap: { borderRadius: 16, overflow: "hidden", backgroundColor: OB.offWhite },
  datePickerDone: { minHeight: 42, alignItems: "center", justifyContent: "center", backgroundColor: OB.primary },
  datePickerDoneText: { color: "#fff", fontWeight: "900" },
  removeDeadline: { alignSelf: "flex-start" },
  removeDeadlineText: { color: "#B94A4A", fontSize: 10, fontWeight: "900" },
  planGrid: { flexDirection: "row", gap: 10 },
  planMetric: { flex: 1, minWidth: 0, borderRadius: 15, padding: 12, backgroundColor: "rgba(123,160,200,0.14)" },
  planMetricLabel: { color: OB.support, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  planMetricValue: { color: OB.primary, fontSize: 13, fontWeight: "900", marginTop: 6 },
  saveDetailsButton: { minHeight: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: OB.primary },
  saveDetailsText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  buttonDisabled: { opacity: 0.4 },
  fieldLabel: { color: OB.support, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 },
  optionalLabel: { textTransform: "none", letterSpacing: 0, fontWeight: "700" },
  moneyInputWrap: { minHeight: 54, borderRadius: 16, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: OB.offWhite, borderWidth: 1, borderColor: OB.supportSoft },
  moneyPrefix: { color: OB.support, fontSize: 14, fontWeight: "900" },
  moneyInput: { flex: 1, color: OB.primary, fontSize: 17, fontWeight: "900" },
  noteInput: { minHeight: 52, borderRadius: 16, paddingHorizontal: 14, color: OB.primary, fontSize: 13, fontWeight: "700", backgroundColor: OB.offWhite, borderWidth: 1, borderColor: OB.supportSoft },
  amountError: { color: "#B94A4A", fontSize: 10, fontWeight: "900" },
  contributionButton: { minHeight: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: OB.primary },
  contributionButtonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  calendarHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calendarArrow: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: OB.offWhite },
  calendarArrowDisabled: { opacity: 0.3 },
  calendarMonth: { color: OB.primary, fontSize: 14, fontWeight: "900", textTransform: "capitalize" },
  weekRow: { flexDirection: "row" },
  weekday: { width: "14.2857%", textAlign: "center", color: OB.support, fontSize: 10, fontWeight: "900" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 5 },
  calendarCell: { width: "14.2857%", height: 46, alignItems: "center", justifyContent: "center" },
  dayCircle: { width: 31, height: 31, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  dayCircleContribution: { borderWidth: 2, borderColor: "#2F73E0", backgroundColor: "rgba(47,115,224,0.07)" },
  dayCircleSelected: { borderWidth: 2, borderColor: OB.primary, backgroundColor: OB.primary },
  dayText: { color: OB.primary, fontSize: 12, fontWeight: "900" },
  dayTextContribution: { color: "#2F73E0" },
  dayTextSelected: { color: "#fff" },
  calendarLegend: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  legendDay: { width: 21, height: 21, borderRadius: 999, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#2F73E0", backgroundColor: "rgba(47,115,224,0.07)" },
  legendDayText: { color: "#2F73E0", fontSize: 7, fontWeight: "900" },
  calendarLegendText: { color: OB.support, fontSize: 9, fontWeight: "800" },
  selectedDayCard: { borderRadius: 16, padding: 12, gap: 9, backgroundColor: OB.offWhite, borderWidth: 1, borderColor: OB.supportSoft },
  selectedDayTitle: { color: OB.primary, fontSize: 12, fontWeight: "900" },
  historyRow: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: OB.supportSoft, paddingTop: 9 },
  historyIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(22,155,98,0.12)" },
  historyAmount: { color: OB.primary, fontSize: 13, fontWeight: "900" },
  historyMeta: { color: OB.support, fontSize: 10, fontWeight: "700", marginTop: 3 },
  emptyDayText: { color: OB.support, fontSize: 11, fontWeight: "800" },
  calendarHint: { color: OB.support, fontSize: 10, fontWeight: "800", textAlign: "center" },
  pressed: { opacity: 0.82 },
});
