export const PASSWORD_REQUIREMENTS = [
  { key: "minLength", label: "8 caracteres ou mais" },
  { key: "uppercase", label: "Uma letra maiúscula" },
  { key: "lowercase", label: "Uma letra minúscula" },
  { key: "number", label: "Um número" },
  { key: "special", label: "Um caractere especial" },
] as const;

export type PasswordRequirementKey = typeof PASSWORD_REQUIREMENTS[number]["key"];
export type PasswordStrength = "Fraca" | "Média" | "Forte";

export type PasswordValidation = {
  requirements: Record<PasswordRequirementKey, boolean>;
  metCount: number;
  strength: PasswordStrength;
  isValid: boolean;
};

export type SignupCredentialsValidation = {
  normalizedEmail: string;
  emailValid: boolean;
  password: PasswordValidation;
  passwordsMatch: boolean;
  isValid: boolean;
};

const COMMON_EMAIL_DOMAIN_TYPOS = new Map<string, string>([
  ["gamil.com", "gmail.com"],
  ["gmial.com", "gmail.com"],
  ["hotmial.com", "hotmail.com"],
  ["outlok.com", "outlook.com"],
  ["outllok.com", "outlook.com"],
]);

export function validatePassword(password: string): PasswordValidation {
  const normalizedPassword = password.normalize("NFC");
  const requirements: PasswordValidation["requirements"] = {
    minLength: Array.from(normalizedPassword).length >= 8,
    uppercase: /\p{Lu}/u.test(normalizedPassword),
    lowercase: /\p{Ll}/u.test(normalizedPassword),
    number: /[0-9]/.test(normalizedPassword),
    special: /[^\p{L}\p{N}\p{M}\s]/u.test(normalizedPassword),
  };
  const metCount = Object.values(requirements).filter(Boolean).length;
  const isValid = metCount === PASSWORD_REQUIREMENTS.length;

  return {
    requirements,
    metCount,
    isValid,
    strength: isValid ? "Forte" : metCount >= 3 ? "Média" : "Fraca",
  };
}

export function normalizeEmail(value: string) {
  const email = value.trim().normalize("NFC");
  const atIndex = email.lastIndexOf("@");
  if (atIndex < 0) return email;
  return `${email.slice(0, atIndex)}@${email.slice(atIndex + 1).toLowerCase()}`;
}

function isValidEmailLocalPart(localPart: string) {
  return Boolean(
    localPart &&
    localPart.length <= 64 &&
    !localPart.startsWith(".") &&
    !localPart.endsWith(".") &&
    !localPart.includes("..") &&
    /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u.test(localPart)
  );
}

export function isValidEmail(value: string) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || /\s/.test(email)) return false;

  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) return false;

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!domain || !isValidEmailLocalPart(localPart)) {
    return false;
  }

  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-") || !/^[\p{L}\p{N}-]+$/u.test(label))) {
    return false;
  }

  const extension = labels[labels.length - 1];
  return extension.length >= 2 && /\p{L}/u.test(extension);
}

export function getEmailDomainSuggestion(value: string) {
  const email = normalizeEmail(value);
  if (/\s/.test(email)) return null;

  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) return null;

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (!isValidEmailLocalPart(localPart)) return null;
  const correctedDomain = COMMON_EMAIL_DOMAIN_TYPOS.get(domain);
  return correctedDomain ? `${localPart}@${correctedDomain}` : null;
}

export function validateSignupCredentials({
  email,
  password,
  confirmPassword,
}: {
  email: string;
  password: string;
  confirmPassword: string;
}): SignupCredentialsValidation {
  const normalizedEmail = normalizeEmail(email);
  const emailValid = isValidEmail(normalizedEmail);
  const passwordValidation = validatePassword(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  return {
    normalizedEmail,
    emailValid,
    password: passwordValidation,
    passwordsMatch,
    isValid: emailValid && passwordValidation.isValid && passwordsMatch,
  };
}

export function getSignupErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  const message = rawMessage.toLowerCase();
  const code = typeof error === "object" && error && "code" in error
    ? String(error.code).toLowerCase()
    : "";

  if (code === "user_already_exists" || message.includes("already registered") || message.includes("already been registered") || message.includes("user already exists")) {
    return "Não foi possível concluir o cadastro. Tente entrar ou recuperar sua senha.";
  }
  if (code === "email_address_invalid" || message.includes("invalid email") || message.includes("email address") && message.includes("invalid")) {
    return "Digite um e-mail válido.";
  }
  if (code.includes("rate_limit") || message.includes("rate limit") || message.includes("too many")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return "Não foi possível conectar agora. Confira sua internet e tente novamente.";
  }
  if (
    code === "weak_password" || message.includes("weak_password") ||
    message.includes("weak password") ||
    message.includes("password should contain") ||
    message.includes("password must contain") ||
    message.includes("password should be at least") ||
    message.includes("password must be at least") ||
    message.includes("password is too short")
  ) {
    return "Sua senha ainda não atende aos requisitos de segurança.";
  }

  return "Não foi possível criar sua conta agora. Tente novamente em instantes.";
}

export function getPasswordUpdateErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  const message = rawMessage.toLowerCase();
  const code = typeof error === "object" && error && "code" in error
    ? String(error.code).toLowerCase()
    : "";

  if (code === "same_password" || message.includes("different from the old password") || message.includes("different from old password")) {
    return "A nova senha precisa ser diferente da senha anterior.";
  }
  if (code.includes("rate_limit") || message.includes("rate limit") || message.includes("too many")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return "Não foi possível conectar agora. Confira sua internet e tente novamente.";
  }
  if (
    code === "weak_password" || message.includes("weak_password") ||
    message.includes("weak password") ||
    message.includes("password should contain") ||
    message.includes("password must contain") ||
    message.includes("password should be at least") ||
    message.includes("password must be at least") ||
    message.includes("password is too short")
  ) {
    return "Sua senha ainda não atende aos requisitos de segurança.";
  }

  return "Não foi possível atualizar sua senha agora. Solicite um novo link e tente novamente.";
}

export function getLoginErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  const message = rawMessage.toLowerCase();
  const code = typeof error === "object" && error && "code" in error
    ? String(error.code).toLowerCase()
    : "";

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }
  if (code.includes("rate_limit") || message.includes("rate limit") || message.includes("too many")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return "Não foi possível conectar agora. Confira sua internet e tente novamente.";
  }

  return "Não foi possível entrar agora. Tente novamente em instantes.";
}

export function getPasswordResetRequestErrorMessage(error: unknown) {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  const message = rawMessage.toLowerCase();
  const code = typeof error === "object" && error && "code" in error
    ? String(error.code).toLowerCase()
    : "";

  if (code.includes("rate_limit") || message.includes("rate limit") || message.includes("too many")) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return "Não foi possível conectar agora. Confira sua internet e tente novamente.";
  }

  return "Não foi possível enviar o link agora. Tente novamente em instantes.";
}
