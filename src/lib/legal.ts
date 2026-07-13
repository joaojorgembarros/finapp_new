import { Linking } from "react-native";

export const LEGAL_URLS = {
  terms: process.env.EXPO_PUBLIC_TERMS_URL ?? "",
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL ?? "",
  deletion: process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL ?? "",
};

export async function openLegalUrl(url: string) {
  if (!url) throw new Error("URL ainda não configurada para esta versão.");
  await Linking.openURL(url);
}
