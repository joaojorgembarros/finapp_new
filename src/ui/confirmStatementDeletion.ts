import { Alert } from "react-native";
import { findBankById } from "../lib/banks";
import {
  buildStatementDeletionDialog,
  formatStatementPeriod,
  loadStatementDeletionPreflight,
} from "../lib/statementImportManagement";
import type { StatementImport } from "../lib/statementImports";

export function confirmStatementDeletion(input: {
  householdId: string;
  statement: Pick<StatementImport, "id" | "bank_id" | "period_start" | "period_end">;
  onConfirm: () => void;
}) {
  void (async () => {
    try {
      const preflight = await loadStatementDeletionPreflight(input.householdId, input.statement.id);
      const dialog = buildStatementDeletionDialog({
        bankName: findBankById(input.statement.bank_id)?.name ?? "",
        periodLabel: formatStatementPeriod(input.statement.period_start, input.statement.period_end),
        preflight,
      });
      if (!dialog.canDelete) {
        Alert.alert(dialog.title, dialog.message, [{ text: "Entendi" }]);
        return;
      }
      Alert.alert(dialog.title, dialog.message, [
        { text: "Cancelar", style: "cancel" },
        { text: "Excluir extrato", style: "destructive", onPress: input.onConfirm },
      ]);
    } catch (error: any) {
      Alert.alert(
        "Não foi possível excluir",
        error?.message ?? "Tente novamente em alguns instantes.",
      );
    }
  })();
}
