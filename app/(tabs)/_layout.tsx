// app/(tabs)/_layout.tsx
import React from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../../src/ui/theme";
import { DrawerHost, DrawerProvider } from "../../src/ui/drawer";

function AddIcon({ focused }: { focused: boolean }) {
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 28,
        marginTop: -28,
        overflow: "hidden",
        ...theme.shadow,
      }}
    >
      <LinearGradient
        colors={theme.gradient.brand}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", opacity: focused ? 1 : 0.94 }}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </LinearGradient>
    </View>
  );
}

function TabsShell() {
  const insets = useSafeAreaInsets();

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            height: 72 + insets.bottom,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
            backgroundColor: theme.colors.bg0,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: "800",
          },
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.muted2,
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: "Início",
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
          }}
        />

        <Tabs.Screen
          name="planning"
          options={{
            title: "Orçamento",
            tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" size={size} color={color} />,
          }}
        />

        <Tabs.Screen
          name="add-transaction"
          options={{
            title: "Adicionar",
            tabBarIcon: ({ focused }) => <AddIcon focused={focused} />,
          }}
        />

        <Tabs.Screen
          name="history"
          options={{ href: null }}
        />

        <Tabs.Screen
          name="goals"
          options={{
            title: "Metas",
            tabBarIcon: ({ color, size }) => <Ionicons name="trophy-outline" size={size} color={color} />,
          }}
        />

        <Tabs.Screen
          name="insights"
          options={{
            title: "Gráficos",
            tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" size={size} color={color} />,
          }}
        />

        <Tabs.Screen name="closures" options={{ href: null }} />
        <Tabs.Screen name="cards" options={{ href: null }} />
        <Tabs.Screen name="new-card-charge" options={{ href: null }} />
        <Tabs.Screen name="create-household" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ href: null }} />
        <Tabs.Screen name="categories" options={{ href: null }} />
        <Tabs.Screen name="import-extract" options={{ href: null }} />
        <Tabs.Screen name="import-csv" options={{ href: null }} />
      </Tabs>

      <DrawerHost />
    </>
  );
}

export default function TabsLayout() {
  return (
    <DrawerProvider>
      <TabsShell />
    </DrawerProvider>
  );
}
