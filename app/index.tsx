import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Href, Redirect } from "expo-router";
import { useSession } from "../src/providers/SessionProvider";
import { hasCompletedNewOnboarding, syncNewOnboardingCompletion } from "../src/lib/newOnboarding";
import { theme } from "../src/ui/theme";

export default function Index() {
  const { session, userId, loading } = useSession();
  const [destination, setDestination] = useState<Href | null>(null);

  useEffect(() => {
    let alive = true;
    if (loading) return;
    if (!userId || !session) {
      setDestination("/(auth)/login");
      return;
    }

    const remoteDone = session.user.user_metadata?.new_onboarding_done === true;
    if (remoteDone) {
      setDestination("/(onboarding)/journey");
      return;
    }

    hasCompletedNewOnboarding(userId).then((localDone) => {
      if (!alive) return;
      if (localDone) {
        syncNewOnboardingCompletion().catch(() => {});
        setDestination("/(onboarding)/journey");
      } else {
        setDestination("/(onboarding)/dreams");
      }
    });

    return () => { alive = false; };
  }, [loading, session, userId]);

  if (destination) return <Redirect href={destination} />;
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg0 }}>
    <ActivityIndicator color={theme.colors.primary} />
  </View>;
}
