import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";
import type { CatalogBankId } from "../lib/banks";
import { BANK_LOGO_SVGS } from "./bankLogoSvgs";

type Props = {
  bankId: string;
  size?: number;
  color?: string;
  shortName?: string;
  style?: StyleProp<ViewStyle>;
};

function fallbackIcon(bankId: string) {
  if (bankId === "dinheiro") return "wallet-outline";
  if (bankId === "outro-banco") return "add";
  if (bankId === "no-bank") return "remove";
  return null;
}

export function BankLogo({ bankId, size = 42, color = "#64748B", shortName = "?", style }: Props) {
  const xml = BANK_LOGO_SVGS[bankId as CatalogBankId];
  const icon = fallbackIcon(bankId);
  const radius = size * 0.15;

  return (
    <View
      accessible={false}
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: xml ? "transparent" : color,
        },
        style,
      ]}
    >
      {xml ? (
        <SvgXml xml={xml} width={size} height={size} />
      ) : icon ? (
        <Ionicons name={icon} size={size * 0.48} color="#fff" />
      ) : (
        <Text style={[styles.fallbackText, { fontSize: Math.max(10, size * 0.26) }]}>{shortName}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  fallbackText: {
    color: "#fff",
    fontWeight: "900",
  },
});
