import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Href, Redirect } from "expo-router";
import { getPostAuthHref } from "../src/lib/postAuthHref";
import { PASSWORD_RECOVERY_HREF } from "../src/lib/passwordRecovery";
import { useSession } from "../src/providers/SessionProvider";
import { theme } from "../src/ui/theme";

export default function Index() {
  const { session, userId, loading, passwordRecoveryOpen } = useSession();
  const [destination, setDestination] = useState<Href | null>(null);

  useEffect(() => {
    if (loading) return;
    if (passwordRecoveryOpen) {
      setDestination(PASSWORD_RECOVERY_HREF);
      return;
    }
    if (!userId || !session) {
      setDestination("/(auth)/login");
      return;
    }

    setDestination(getPostAuthHref(session));
  }, [loading, session, userId, passwordRecoveryOpen]);

  if (destination) return <Redirect href={destination} />;
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg0 }}>
    <ActivityIndicator color={theme.colors.primary} />
  </View>;
}
