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
    subtitle: "Ideal para importacao rapida e estruturada",
    icon: "grid-outline",
    iconColor: theme.colors.primary,
    iconBg: theme.colors.primarySoft,
    recommended: true,
    route: "/(tabs)/import-csv",
  },
  {
    title: "Excel (.xlsx)",
    subtitle: "Importe planilhas bancarias em formato Excel",
    icon: "document-text-outline",
    iconColor: theme.colors.good,
    iconBg: theme.colors.goodSoft,
    recommended: true,
  },
  {
    title: "PDF",
    subtitle: "Leitura disponivel, mas pode exigir mais revisao",
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

    Alert.alert("Importar extrato", `Selecao de arquivo ${format.title} sera conectada na proxima etapa.`);
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
      <AppHeader title="Importar Extrato" subtitle="Importe movimentacoes do banco e revise antes de salvar" />

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
          title="Formatos Recomendados"
          text="CSV e Excel garantem melhor precisao na leitura dos dados. Voce podera revisar todas as transacoes antes de importar."
          tone="primary"
        />

        <InfoCard
          icon="alert-circle-outline"
          title="Atencao com PDF"
          text="Arquivos PDF podem exigir mais revisao manual devido as variacoes de formato entre bancos."
          tone="warn"
        />
      </View>
    </Screen>
  );
}
