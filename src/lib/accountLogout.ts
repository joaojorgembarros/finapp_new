import {
  getSignOutFeedback,
  shouldLeaveAuthenticatedApp,
  type SignOutResult,
} from "./signOutSession";

export function canStartLogout(busy: boolean) {
  return !busy;
}

export async function runAccountLogout(input: {
  busy: boolean;
  signOut: () => Promise<SignOutResult>;
  replaceLogin: () => void;
  showFeedback: (title: string, message: string) => void;
  setBusy: (busy: boolean) => void;
}) {
  if (!canStartLogout(input.busy)) return;

  input.setBusy(true);
  try {
    const result = await input.signOut();
    if (result.activeAccountChanged) return;

    if (shouldLeaveAuthenticatedApp(result)) {
      input.replaceLogin();
    }

    const feedback = getSignOutFeedback(result);
    if (feedback) input.showFeedback(feedback.title, feedback.message);
  } catch {
    input.showFeedback(
      "Não foi possível sair",
      "Não foi possível sair agora. Tente novamente.",
    );
  } finally {
    input.setBusy(false);
  }
}
