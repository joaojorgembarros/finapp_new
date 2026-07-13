import * as Linking from "expo-linking";
import { supabase } from "./supabase";

export function passwordResetRedirectUrl() {
  return Linking.createURL("/reset-password");
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: passwordResetRedirectUrl(),
  });
  if (error) throw error;
}

export async function deleteOwnAccount() {
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw error;
  await supabase.auth.signOut({ scope: "local" });
}
