// app/_layout.tsx
import React from "react";
import { Stack } from "expo-router";
import { SessionProvider } from "../src/providers/SessionProvider";

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
