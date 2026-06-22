import AsyncStorage from "@react-native-async-storage/async-storage";

function keyFor(userId: string) {
  return `finapp:new-figma-onboarding:${userId}`;
}

export async function hasCompletedNewOnboarding(userId: string) {
  return (await AsyncStorage.getItem(keyFor(userId))) === "done";
}

export async function markNewOnboardingDone(userId: string) {
  await AsyncStorage.setItem(keyFor(userId), "done");
}
