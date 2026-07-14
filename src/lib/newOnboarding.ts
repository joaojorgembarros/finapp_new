import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { createHousehold, getMyHouseholdId } from "./household";
import { seedDefaultCategories } from "./categories";
import { syncGoalsFromDreams } from "./goals";

function keyFor(userId: string) {
  return `finapp:new-figma-onboarding:${userId}`;
}

export async function hasCompletedNewOnboarding(userId: string) {
  return (await AsyncStorage.getItem(keyFor(userId))) === "done";
}

export async function syncNewOnboardingCompletion(dreams?: string[], values?: Record<string, string>) {
  const data: Record<string, unknown> = { new_onboarding_done: true };
  if (dreams) data.finapp_dreams = dreams;
  if (values) data.finapp_dream_values = values;
  const { error } = await supabase.auth.updateUser({ data });
  if (error) throw error;
}

export async function markNewOnboardingDone(userId: string, dreams: string[], values: Record<string, string>) {
  let householdId = await getMyHouseholdId(userId);
  if (!householdId) {
    householdId = await createHousehold({ name: "Minha casa", type: "individual" });
  }
  await seedDefaultCategories(householdId);
  await syncGoalsFromDreams({ householdId, userId, dreams, values });
  await syncNewOnboardingCompletion(dreams, values);
  await AsyncStorage.setItem(keyFor(userId), "done");
}
