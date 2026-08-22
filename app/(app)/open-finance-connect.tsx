import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useOpenFinancePolpAuthorization } from "../../src/hooks/useOpenFinancePolpAuthorization";
import { useOpenFinancePolpCompletion } from "../../src/hooks/useOpenFinancePolpCompletion";
import { useOpenFinancePolpStart } from "../../src/hooks/useOpenFinancePolpStart";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import {
  canSubmitOpenFinanceConnectForm,
  connectHouseholdMessage,
  filterConnectInstitutions,
  formatPolpCpfMask,
  planInstitutionPickerOpen,
  polpCpfFieldError,
  resolveConnectHouseholdGate,
  submitOpenFinanceConnectForm,
  toConnectInstitutionOption,
  type OpenFinanceConnectInstitutionOption,
} from "../../src/lib/open-finance-polp-connect-form";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { ScreenHeaderCard } from "../../src/ui/ScreenHeaderCard";

function InstitutionLogo({
  logoUrl,
  size,
}: {
  logoUrl: string | null;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  if (!logoUrl || failed) {
    return (
      <View style={[styles.logoFallback, { width: size, height: size, borderRadius: size * 0.32 }]}>
        <Ionicons name="business-outline" size={Math.round(size * 0.46)} color={OB.primary} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: logoUrl }}
      style={{ width: size, height: size, borderRadius: size * 0.32 }}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}

export default function OpenFinanceConnectScreen() {
  const {
    institutions,
    institutionsLoading,
    institutionsError,
    reloadInstitutions,
    startConnection,
    starting,
    householdId,
    householdLoading,
  } = useOpenFinancePolpStart();
  const authorization = useOpenFinancePolpAuthorization({
    householdId,
    startConnection,
  });
  const completion = useOpenFinancePolpCompletion({
    authorizationPhase: authorization.phase,
    completionContext: authorization.completionContext,
  });
  const { scrollRef, keyboardInset, registerField, focusField, cancelPendingScroll } =
    useKeyboardAwareScroll<"cpf">(18);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [alreadyRequested, setAlreadyRequested] = useState(false);
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(null);
  const [cpf, setCpf] = useState("");
  const [cpfTouched, setCpfTouched] = useState(false);
  const [institutionError, setInstitutionError] = useState<string | null>(null);

  const householdGate = resolveConnectHouseholdGate(householdLoading, householdId);
  const householdMessage = connectHouseholdMessage(householdGate);
  const institutionOptions = useMemo(
    () => institutions.map(toConnectInstitutionOption),
    [institutions],
  );
  const visibleInstitutions = useMemo(
    () => filterConnectInstitutions(institutionOptions, institutionQuery),
    [institutionOptions, institutionQuery],
  );
  const selectedInstitution = institutionOptions.find((item) => item.id === selectedInstitutionId) ?? null;
  const cpfError = polpCpfFieldError(cpf, cpfTouched);
  const continueEnabled = canSubmitOpenFinanceConnectForm({
    householdLoading,
    householdId,
    institutionId: selectedInstitutionId,
    cpfInput: cpf,
  }) && authorization.canStart && !starting;

  async function loadInstitutions() {
    try {
      await reloadInstitutions();
    } catch {
      // The hook already stores a safe institutionsError.
    }
  }

  function openPicker() {
    if (authorization.formLocked) return;
    const next = planInstitutionPickerOpen({
      alreadyRequested,
      institutionsLoading,
    });
    setPickerOpen(true);
    setAlreadyRequested(next.alreadyRequested);
    if (next.shouldLoad) void loadInstitutions();
  }

  function retryInstitutions() {
    setAlreadyRequested(true);
    void loadInstitutions();
  }

  function chooseInstitution(option: OpenFinanceConnectInstitutionOption) {
    setSelectedInstitutionId(option.id);
    setInstitutionError(null);
    setPickerOpen(false);
    setInstitutionQuery("");
  }

  function onCpfChange(value: string) {
    setCpf(formatPolpCpfMask(value));
  }

  async function onContinue() {
    Keyboard.dismiss();
    const result = submitOpenFinanceConnectForm({
      householdLoading,
      householdId,
      institutionId: selectedInstitutionId,
      cpfInput: cpf,
    });
    setCpfTouched(true);
    if (!result.ok) {
      setInstitutionError(result.institutionError);
      return;
    }
    setInstitutionError(null);
    await authorization.start({
      institutionId: result.institutionId,
      cpf,
    });
  }

  function resetAuthorization() {
    completion.reset();
    authorization.reset();
  }

  return (
    <OnboardingShell light>
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={styles.screen}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, { paddingBottom: 32 + keyboardInset }]}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="none"
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={cancelPendingScroll}
        >
          <ScreenHeaderCard
            eyebrow="Contas"
            title="Conectar banco"
            subtitle="Escolha sua instituição e informe os dados necessários para iniciar a conexão."
            onBack={() => router.back()}
          />

          {householdMessage ? (
            <View style={[styles.infoCard, householdGate === "missing" && styles.warningCard]}>
              <Ionicons
                name={householdGate === "missing" ? "alert-circle-outline" : "hourglass-outline"}
                size={19}
                color={householdGate === "missing" ? "#B42318" : OB.primary}
              />
              <Text style={[styles.infoText, householdGate === "missing" && styles.warningText]}>
                {householdMessage}
              </Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Instituição</Text>
            <Pressable
              onPress={openPicker}
              disabled={authorization.formLocked}
              style={({ pressed }) => [
                styles.selectButton,
                selectedInstitution && styles.selectButtonSelected,
                authorization.formLocked && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Escolher banco"
            >
              <InstitutionLogo logoUrl={selectedInstitution?.logoUrl ?? null} size={42} />
              <View style={styles.flex}>
                <Text style={styles.selectCaption}>
                  {selectedInstitution ? "Banco selecionado" : "Escolha o banco"}
                </Text>
                <Text style={styles.selectName} numberOfLines={1}>
                  {selectedInstitution?.label ?? "Qual instituição você quer conectar?"}
                </Text>
              </View>
              <Text style={styles.selectAction}>{selectedInstitution ? "Alterar" : "Escolher"}</Text>
              <Ionicons name="chevron-forward" size={17} color={OB.primary} />
            </Pressable>
            {institutionError ? <Text style={styles.fieldError}>{institutionError}</Text> : null}
          </View>

          <View style={styles.card} onLayout={registerField("cpf")}>
            <Text style={styles.sectionTitle}>CPF</Text>
            <TextInput
              value={cpf}
              onChangeText={onCpfChange}
              onFocus={() => focusField("cpf")}
              onPressIn={() => focusField("cpf")}
              onBlur={() => setCpfTouched(true)}
              onSubmitEditing={Keyboard.dismiss}
              placeholder="000.000.000-00"
              placeholderTextColor={OB.support}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={14}
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              importantForAutofill="no"
              editable={!authorization.formLocked}
              style={[styles.input, cpfError && styles.inputError]}
              accessibilityLabel="CPF"
            />
            {cpfError ? <Text style={styles.fieldError}>{cpfError}</Text> : null}
          </View>

          <View style={styles.infoCard}>
            <Ionicons name="shield-checkmark-outline" size={19} color={OB.primary} />
            <View style={styles.flex}>
              <Text style={styles.infoTitle}>Conexão com sua autorização</Text>
              <Text style={styles.infoText}>
                Seus dados bancários são acessados somente com sua autorização. Você poderá cancelar a conexão quando quiser.
              </Text>
            </View>
          </View>

          {authorization.phase !== "idle" && authorization.title ? (
            <View style={[
              styles.infoCard,
              authorization.phase === "ready_to_complete" && styles.readyCard,
              (authorization.phase === "rejected"
                || authorization.phase === "expired"
                || authorization.phase === "provider_error"
                || authorization.phase === "error") && styles.warningCard,
            ]}>
              <Ionicons
                name={
                  authorization.phase === "ready_to_complete"
                    ? "checkmark-circle-outline"
                    : authorization.phase === "checking" || authorization.phase === "starting"
                      ? "hourglass-outline"
                      : authorization.phase === "awaiting_authorization" || authorization.phase === "timed_out"
                        ? "open-outline"
                        : "alert-circle-outline"
                }
                size={21}
                color={authorization.phase === "ready_to_complete" ? "#178A55" : authorization.phase === "awaiting_authorization" || authorization.phase === "checking" || authorization.phase === "starting" || authorization.phase === "timed_out" ? OB.primary : "#B42318"}
              />
              <View style={styles.flex}>
                <Text style={[
                  styles.infoTitle,
                  authorization.phase === "ready_to_complete" && styles.readyTitle,
                  (authorization.phase === "rejected"
                    || authorization.phase === "expired"
                    || authorization.phase === "provider_error"
                    || authorization.phase === "error") && styles.warningTitle,
                ]}>
                  {authorization.title}
                </Text>
                {authorization.message ? (
                  <Text style={[
                    styles.infoText,
                    authorization.phase === "ready_to_complete" && styles.readyText,
                  ]}>
                    {authorization.message}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {completion.phase === "error" ? (
            <View style={[styles.infoCard, styles.warningCard]}>
              <Ionicons name="alert-circle-outline" size={21} color="#B42318" />
              <View style={styles.flex}>
                <Text style={styles.warningTitle}>Não foi possível concluir</Text>
                <Text style={styles.warningText}>{completion.errorMessage}</Text>
              </View>
            </View>
          ) : null}

          {completion.phase === "completed" ? (
            <View style={styles.completedCard}>
              <View style={styles.completedHeader}>
                <Ionicons name="checkmark-circle" size={24} color="#178A55" />
                <View style={styles.flex}>
                  <Text style={styles.completedTitle}>Banco conectado</Text>
                  <Text style={styles.completedText}>Sua conexão foi concluída com sucesso.</Text>
                </View>
              </View>
              {completion.resources.length ? (
                <View style={styles.resourceList}>
                  {completion.resources.map((resource) => (
                    <View key={resource.key} style={styles.resourceItem}>
                      <Ionicons
                        name={resource.type === "credit_card" ? "card-outline" : "wallet-outline"}
                        size={20}
                        color={OB.primary}
                      />
                      <View style={styles.flex}>
                        <Text style={styles.resourceTitle}>{resource.title}</Text>
                        <Text style={styles.resourceName}>{resource.name}</Text>
                        {resource.mask ? <Text style={styles.resourceMask}>{resource.mask}</Text> : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.completedText}>
                  Nenhuma conta ou cartão foi retornado pela instituição.
                </Text>
              )}
            </View>
          ) : null}

          {authorization.phase === "ready_to_complete" && completion.phase !== "completed" ? (
            <Pressable
              onPress={() => void (completion.phase === "error" ? completion.retry() : completion.complete())}
              disabled={completion.phase === "completing"}
              style={[
                styles.continueButton,
                completion.phase === "completing" && styles.continueButtonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: completion.phase === "completing" }}
              accessibilityLabel={completion.phase === "error" ? "Tentar concluir novamente" : "Concluir conexão"}
            >
              <Text style={[
                styles.continueText,
                completion.phase === "completing" && styles.continueTextDisabled,
              ]}>
                {completion.phase === "completing"
                  ? "Concluindo conexão..."
                  : completion.phase === "error"
                    ? "Tentar concluir novamente"
                    : "Concluir conexão"}
              </Text>
            </Pressable>
          ) : null}

          {authorization.canOpenAuthorization
            || authorization.canCheckAgain
            || (authorization.canReset && authorization.phase !== "ready_to_complete") ? (
            <View style={styles.actionRow}>
              {authorization.canOpenAuthorization ? (
                <Pressable
                  onPress={() => void authorization.openAuthorization()}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Abrir banco novamente"
                >
                  <Text style={styles.secondaryText}>Abrir banco novamente</Text>
                </Pressable>
              ) : null}
              {authorization.canCheckAgain ? (
                <Pressable
                  onPress={() => void authorization.checkAgain()}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Verificar novamente"
                >
                  <Text style={styles.secondaryText}>Verificar novamente</Text>
                </Pressable>
              ) : null}
              {authorization.canReset && authorization.phase !== "ready_to_complete" ? (
                <Pressable
                  onPress={resetAuthorization}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                  accessibilityLabel="Tentar nova conexão"
                >
                  <Text style={styles.secondaryText}>Tentar nova conexão</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Pressable
            onPress={onContinue}
            disabled={!continueEnabled}
            style={[styles.continueButton, !continueEnabled && styles.continueButtonDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !continueEnabled }}
            accessibilityLabel="Continuar"
          >
            <Text style={[styles.continueText, !continueEnabled && styles.continueTextDisabled]}>
              {starting || authorization.phase === "starting" ? "Iniciando..." : "Continuar"}
            </Text>
          </Pressable>
        </ScrollView>

        <Modal
          visible={pickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setPickerOpen(false)}
        >
          <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
            <Pressable style={styles.pickerCard} onPress={(event) => event.stopPropagation()}>
              <View style={styles.pickerHeader}>
                <View style={styles.pickerHeaderIcon}>
                  <Ionicons name="business-outline" size={20} color={OB.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.pickerTitle}>Escolher banco</Text>
                  <Text style={styles.pickerSubtitle}>Selecione a instituição da conta que você quer conectar.</Text>
                </View>
                <Pressable
                  onPress={() => setPickerOpen(false)}
                  style={styles.pickerClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Fechar"
                >
                  <Ionicons name="close" size={20} color={OB.support} />
                </Pressable>
              </View>

              <TextInput
                value={institutionQuery}
                onChangeText={setInstitutionQuery}
                placeholder="Buscar pelo nome"
                placeholderTextColor={OB.support}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                style={styles.searchInput}
                accessibilityLabel="Buscar instituição"
              />

              {institutionsLoading ? (
                <View style={styles.pickerState}>
                  <ActivityIndicator color={OB.primary} />
                  <Text style={styles.mutedText}>Carregando instituições...</Text>
                </View>
              ) : institutionsError ? (
                <View style={styles.pickerState}>
                  <Text style={styles.warningText}>{institutionsError}</Text>
                  <Pressable onPress={retryInstitutions} style={styles.retryButton} accessibilityRole="button">
                    <Text style={styles.retryText}>Tentar novamente</Text>
                  </Pressable>
                </View>
              ) : visibleInstitutions.length === 0 ? (
                <View style={styles.pickerState}>
                  <Text style={styles.mutedText}>
                    {institutionOptions.length
                      ? "Nenhuma instituição encontrada com esse nome."
                      : "Nenhuma instituição disponível no momento."}
                  </Text>
                  {!institutionOptions.length ? (
                    <Pressable onPress={retryInstitutions} style={styles.retryButton} accessibilityRole="button">
                      <Text style={styles.retryText}>Tentar novamente</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <FlatList
                  data={visibleInstitutions}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  style={styles.pickerList}
                  contentContainerStyle={styles.pickerListContent}
                  renderItem={({ item }) => {
                    const active = item.id === selectedInstitutionId;
                    return (
                      <Pressable
                        onPress={() => chooseInstitution(item)}
                        style={({ pressed }) => [
                          styles.pickerOption,
                          active && styles.pickerOptionActive,
                          pressed && styles.pressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        accessibilityState={{ selected: active }}
                      >
                        <InstitutionLogo logoUrl={item.logoUrl} size={42} />
                        <Text style={styles.pickerName} numberOfLines={2}>{item.label}</Text>
                        {active
                          ? <Ionicons name="checkmark-circle" size={21} color={OB.primary} />
                          : <Ionicons name="chevron-forward" size={18} color={OB.support} />}
                      </Pressable>
                    );
                  }}
                />
              )}
            </Pressable>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    padding: 20,
    gap: 16,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  sectionTitle: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  selectButton: {
    minHeight: 64,
    borderRadius: 16,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: OB.offWhite,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  selectButtonSelected: {
    backgroundColor: "#fff",
  },
  selectCaption: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  selectName: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 3,
  },
  selectAction: {
    color: OB.primary,
    fontSize: 10,
    fontWeight: "900",
  },
  input: {
    minHeight: 50,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 15,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  inputError: {
    borderColor: "#FDA29B",
    backgroundColor: "#FFF4F2",
  },
  fieldError: {
    color: "#B42318",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  infoCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "rgba(123,160,200,0.14)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  warningCard: {
    backgroundColor: "#FFF4F2",
    borderColor: "#FDA29B",
  },
  infoTitle: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  infoText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 4,
  },
  warningText: {
    color: "#B42318",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  readyCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(23,138,85,0.10)",
    borderWidth: 1,
    borderColor: "rgba(23,138,85,0.28)",
  },
  readyTitle: {
    color: "#178A55",
    fontSize: 13,
    fontWeight: "900",
  },
  readyText: {
    color: "#116B42",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 4,
  },
  continueButton: {
    minHeight: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  continueButtonDisabled: {
    backgroundColor: "rgba(123,160,200,0.32)",
  },
  continueText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  continueTextDisabled: {
    color: OB.support,
  },
  actionRow: {
    gap: 10,
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  secondaryText: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  warningTitle: {
    color: "#B42318",
    fontSize: 13,
    fontWeight: "900",
  },
  completedCard: {
    borderRadius: 18,
    padding: 16,
    gap: 14,
    backgroundColor: "rgba(23,138,85,0.10)",
    borderWidth: 1,
    borderColor: "rgba(23,138,85,0.28)",
  },
  completedHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  completedTitle: {
    color: "#178A55",
    fontSize: 16,
    fontWeight: "900",
  },
  completedText: {
    color: "#116B42",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 3,
  },
  resourceList: {
    gap: 9,
  },
  resourceItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(23,138,85,0.22)",
  },
  resourceTitle: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  resourceName: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 2,
  },
  resourceMask: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  pressed: {
    opacity: 0.84,
  },
  logoFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  pickerBackdrop: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: "rgba(7, 18, 38, 0.62)",
  },
  pickerCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "82%",
    alignSelf: "center",
    borderRadius: 22,
    padding: 18,
    gap: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  pickerHeaderIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  pickerTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
  },
  pickerSubtitle: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
    marginTop: 2,
  },
  pickerClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  searchInput: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingHorizontal: 14,
    color: OB.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  pickerState: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 18,
  },
  mutedText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    textAlign: "center",
  },
  retryButton: {
    minHeight: 43,
    borderRadius: 13,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  retryText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  pickerList: {
    flexGrow: 0,
  },
  pickerListContent: {
    gap: 9,
    paddingBottom: 2,
  },
  pickerOption: {
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: OB.offWhite,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  pickerOptionActive: {
    borderColor: OB.primary,
    backgroundColor: "rgba(123,160,200,0.12)",
  },
  pickerName: {
    flex: 1,
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
});
