// app/index.tsx
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useSession } from "../src/providers/SessionProvider";
import { hasCompletedNewOnboarding } from "../src/lib/newOnboarding";
import { OB } from "../src/ui/OnboardingKit";

export default function Index() {
  const { userId, loading } = useSession();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (loading) return;

      try {
        if (!userId) {
          router.replace("/(auth)/login");
          return;
        }

        const done = await hasCompletedNewOnboarding(userId);
        router.replace(done ? "/(onboarding)/journey" : "/(onboarding)/dreams");
      } finally {
        if (alive) setChecking(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [loading, userId]);

  if (loading || checking) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: OB.offWhite }}>
        <ActivityIndicator color={OB.primary} />
      </View>
    );
  }

  return null;
}
