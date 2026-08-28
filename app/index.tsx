import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Href, Redirect } from "expo-router";
import { getPostAuthHref } from "../src/lib/postAuthHref";
import { useSession } from "../src/providers/SessionProvider";
import { theme } from "../src/ui/theme";

export default function Index() {
  const { session, userId, loading } = useSession();
  const [destination, setDestination] = useState<Href | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!userId || !session) {
      setDestination("/(auth)/welcome");
      return;
    }

    setDestination(getPostAuthHref(session));
  }, [loading, session, userId]);

  if (destination) return <Redirect href={destination} />;
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg0 }}>
    <ActivityIndicator color={theme.colors.primary} />
  </View>;
}
