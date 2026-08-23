import type { Session } from "@supabase/supabase-js";
import type { Href } from "expo-router";

export function getPostAuthHref(session: Session | null | undefined): Href {
  if (!session) return "/(auth)/login";

  const metadata = session.user.user_metadata;
  const hasDreams = Array.isArray(metadata?.finapp_dreams) && metadata.finapp_dreams.length > 0;
  const onboardingDone = metadata?.new_onboarding_done === true && hasDreams;
  const pendingFinancialSituation = metadata?.new_onboarding_step === "financial-situation" && hasDreams;

  if (onboardingDone) return "/(app)/journey";
  if (pendingFinancialSituation) return "/(onboarding)/financial-situation";
  return "/(onboarding)/dreams";
}
