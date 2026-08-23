// app/(auth)/_layout.tsx
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { getPostAuthHref } from "../../src/lib/postAuthHref";
import { useSession } from "../../src/providers/SessionProvider";

export default function AuthLayout() {
  const { session, loading } = useSession();
  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;
  if (session) return <Redirect href={getPostAuthHref(session)} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
