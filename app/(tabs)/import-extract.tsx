// app/(tabs)/import-extract.tsx
import React from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Screen from "../../src/ui/Screen";
import { AppHeader, Card, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";

type FileFormat = {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  recommended?: boolean;
  route?: "/(tabs)/import-csv";
};

const formats: FileFormat[] = [
  {
    title: "CSV",
    subtitle: "Ideal para importação rápida e estruturada",
    icon: "grid-outline",
    iconColor: theme.colors.primary,
    iconBg: theme.colors.primarySoft,
    recommended: true,
    route: "/(tabs)/import-csv",
  },
  {
    title: "Excel (.xlsx)",
    subtitle: "Importe planilhas bancárias em formato Excel",
    icon: "document-text-outline",
    iconColor: theme.colors.good,
    iconBg: theme.colors.goodSoft,
  },
  {
    title: "PDF",
    subtitle: "Leitura disponível, mas pode exigir mais revisão",
    icon: "document-outline",
    iconColor: theme.colors.muted,
    iconBg: "#f1f5f9",
  },
];

function FormatCard({ format }: { format: FileFormat }) {
  function onPress() {
    if (format.route) {
      router.push(format.route);
      return;
    }

    Alert.alert("Em breve", `Importação por ${format.title} será conectada depois do MVP.`);
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderRadius: 18,
          opacity: pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      <Card intensity={18} style={{ borderRadius: 18 }}>
        <Row style={{ gap: 13 }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: format.iconBg,
            }}
          >
            <Ionicons name={format.icon} size={22} color={format.iconColor} />
          </View>

          <View style={{ flex: 1 }}>
            <Row style={{ gap: 7, flexWrap: "wrap" }}>
              <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 14 }}>{format.title}</Text>
              {format.recommended ? (
                <View
                  style={{
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: 999,
                    backgroundColor: theme.colors.primarySoft,
                  }}
                >
                  <Text style={{ color: theme.colors.primary, fontWeight: "900", fontSize: 9 }}>Recomendado</Text>
                </View>
              ) : null}
            </Row>
            <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 11, lineHeight: 16, marginTop: 5 }}>
              {format.subtitle}
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={18} color={theme.colors.muted2} />
        </Row>
      </Card>
    </Pressable>
  );
}

function InfoCard({
  icon,
  title,
  text,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
  tone: "primary" | "warn";
}) {
  const isWarn = tone === "warn";
  const color = isWarn ? theme.colors.warn : theme.colors.primary;
  const border = isWarn ? "#fbbf24" : "#93c5fd";
  const bg = isWarn ? "#fffbeb" : "#eff6ff";

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        padding: 14,
      }}
    >
      <Row style={{ gap: 10, alignItems: "flex-start" }}>
        <Ionicons name={icon} size={18} color={color} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: isWarn ? "#92400e" : "#1e3a8a", fontWeight: "900", fontSize: 13 }}>{title}</Text>
          <Text style={{ color: isWarn ? "#b45309" : "#2563eb", fontWeight: "700", fontSize: 11, lineHeight: 16, marginTop: 5 }}>
            {text}
          </Text>
        </View>
      </Row>
    </View>
  );
}

export default function ImportExtract() {
  return (
    <Screen>
      <AppHeader title="Importar extrato" subtitle="Importe movimentações do banco e revise antes de salvar" />

      <View style={{ gap: 12 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 14 }}>
          Selecione o formato do arquivo
        </Text>

        {formats.map((format) => (
          <FormatCard key={format.title} format={format} />
        ))}
      </View>

      <View style={{ gap: 12, marginTop: 2 }}>
        <InfoCard
          icon="checkmark-circle-outline"
          title="Formato recomendado"
          text="CSV garante melhor precisão na leitura dos dados. Você poderá revisar todas as transações antes de importar."
          tone="primary"
        />

        <InfoCard
          icon="alert-circle-outline"
          title="Atenção com PDF"
          text="Arquivos PDF podem exigir mais revisão manual devido às variações de formato entre bancos."
          tone="warn"
        />
      </View>
    </Screen>
  );
}
