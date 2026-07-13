import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

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
  await AsyncStorage.setItem(keyFor(userId), "done");
  await syncNewOnboardingCompletion(dreams, values);
}
