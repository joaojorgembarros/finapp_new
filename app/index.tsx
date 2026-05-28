// app/index.tsx
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useSession } from "../src/providers/SessionProvider";
import { theme } from "../src/ui/theme";
import { getMyHouseholdId } from "../src/lib/household";
import { getProfile } from "../src/lib/profile";

export default function Index() {
  const { userId, loading } = useSession();
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (loading) return;

      try {
        if (!userId) {
          router.replace("/(auth)/login");
          return;
        }

        const hh = await getMyHouseholdId(userId);
        if (!hh) {
          router.replace("/(tabs)/create-household");
          return;
        }

        const profile = await getProfile(userId);
        if (!profile || !profile.onboarding_done) {
          router.replace("/(onboarding)/income");
          return;
        }

        router.replace("/(tabs)/home");
      } catch {
        router.replace("/(auth)/login");
      } finally {
        if (alive) setBusy(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [userId, loading]);

  if (busy || loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg0 }}>
        <ActivityIndicator />
      </View>
    );
  }
  return null;
}
