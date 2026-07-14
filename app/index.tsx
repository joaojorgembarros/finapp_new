import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Href, Redirect } from "expo-router";
import { useSession } from "../src/providers/SessionProvider";
import { theme } from "../src/ui/theme";

export default function Index() {
  const { session, userId, loading } = useSession();
  const [destination, setDestination] = useState<Href | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!userId || !session) {
      setDestination("/(auth)/login");
      return;
    }

    const metadata = session.user.user_metadata;
    const hasDreams = Array.isArray(metadata?.finapp_dreams) && metadata.finapp_dreams.length > 0;
    const remoteDone = metadata?.new_onboarding_done === true && hasDreams;
    setDestination(remoteDone ? "/(onboarding)/journey" : "/(onboarding)/dreams");
  }, [loading, session, userId]);

  if (destination) return <Redirect href={destination} />;
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg0 }}>
    <ActivityIndicator color={theme.colors.primary} />
  </View>;
}
