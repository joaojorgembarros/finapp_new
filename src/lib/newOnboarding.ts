import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { createHousehold, getMyHouseholdId } from "./household";
import { seedDefaultCategories } from "./categories";
import { syncGoalsFromDreams } from "./goals";

export type FinancialSituation = {
  banks: string[];
  debts: string[];
};

function keyFor(userId: string) {
  return `finapp:new-figma-onboarding:${userId}`;
}

export async function hasCompletedNewOnboarding(userId: string) {
  return (await AsyncStorage.getItem(keyFor(userId))) === "done";
}

export async function saveNewOnboardingDraft(dreams: string[], values: Record<string, string>) {
  const { error } = await supabase.auth.updateUser({
    data: {
      new_onboarding_done: false,
      new_onboarding_step: "financial-situation",
      finapp_dreams: dreams,
      finapp_dream_values: values,
    },
  });
  if (error) throw error;
}

export async function syncNewOnboardingCompletion(
  dreams?: string[],
  values?: Record<string, string>,
  financialSituation?: FinancialSituation
) {
  const data: Record<string, unknown> = {
    new_onboarding_done: true,
    new_onboarding_step: null,
  };
  if (dreams) data.finapp_dreams = dreams;
  if (values) data.finapp_dream_values = values;
  if (financialSituation) {
    data.finapp_banks = financialSituation.banks;
    data.finapp_debts = financialSituation.debts;
  }
  const { error } = await supabase.auth.updateUser({ data });
  if (error) throw error;
}

export async function markNewOnboardingDone(
  userId: string,
  dreams: string[],
  values: Record<string, string>,
  financialSituation?: FinancialSituation
) {
  let householdId = await getMyHouseholdId(userId);
  if (!householdId) {
    householdId = await createHousehold({ name: "Minha casa", type: "individual" });
  }
  await seedDefaultCategories(householdId);
  await syncGoalsFromDreams({ householdId, userId, dreams, values });
  await syncNewOnboardingCompletion(dreams, values, financialSituation);
  await AsyncStorage.setItem(keyFor(userId), "done");
}
