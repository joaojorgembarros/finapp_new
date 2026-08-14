import * as Linking from "expo-linking";
import { supabase } from "./supabase";
import { normalizeEmail } from "./authValidation";

export function passwordResetRedirectUrl() {
  return Linking.createURL("/reset-password");
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo: passwordResetRedirectUrl(),
  });
  if (error) throw error;
}
