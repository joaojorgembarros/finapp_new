import { describe, expect, it } from "vitest";
import {
  getEmailDomainSuggestion,
  getLoginErrorMessage,
  getPasswordResetRequestErrorMessage,
  getPasswordUpdateErrorMessage,
  getSignupErrorMessage,
  isValidEmail,
  normalizeEmail,
  validateSignupCredentials,
  validatePassword,
} from "./authValidation";

describe("password validation", () => {
  it("accepts a password only when every security requirement is met", () => {
    const result = validatePassword("Sonhar@2026");

    expect(result).toMatchObject({
      isValid: true,
      metCount: 5,
      strength: "Forte",
      requirements: {
        minLength: true,
        uppercase: true,
        lowercase: true,
        number: true,
        special: true,
      },
    });
  });

  it.each([
    ["Sonh@26", "minLength"],
    ["sonhar@2026", "uppercase"],
    ["SONHAR@2026", "lowercase"],
    ["Sonhar@abc", "number"],
    ["Sonhar2026", "special"],
  ] as const)("rejects %s when %s is missing", (password, missingRequirement) => {
    const result = validatePassword(password);

    expect(result.isValid).toBe(false);
    expect(result.requirements[missingRequirement]).toBe(false);
  });

  it("does not count whitespace as the special character", () => {
    expect(validatePassword("Sonhar 2026").requirements.special).toBe(false);
  });

  it("counts Unicode characters instead of UTF-16 code units for the minimum length", () => {
    expect(validatePassword("Aa1!😀😀").requirements.minLength).toBe(false);
  });

  it("treats accented characters as letters instead of special characters", () => {
    const result = validatePassword("Árvore2026");

    expect(result.requirements.uppercase).toBe(true);
    expect(result.requirements.lowercase).toBe(true);
    expect(result.requirements.special).toBe(false);
    expect(validatePassword("A\u0301rvore2026").requirements.special).toBe(false);
  });

  it("classifies incomplete passwords by requirements and length", () => {
    expect(validatePassword("abc").strength).toBe("Fraca");
    expect(validatePassword("Sonhar2026").strength).toBe("Média");
    expect(validatePassword("Aa1!aaaa").strength).toBe("Forte");
    expect(validatePassword("Aa1!aaa").isValid).toBe(false);
    expect(validatePassword("Árvore@2026").isValid).toBe(true);
    expect(validatePassword("Sonhar@2026").strength).toBe("Forte");
  });
});

describe("email validation", () => {
  it("trims and normalizes case before authentication", () => {
    expect(normalizeEmail("  Usuario@GMAIL.COM  ")).toBe("Usuario@gmail.com");
  });

  it.each([
    "usuario@dominio.com",
    "usuario+tag@sub.dominio.com.br",
    "o'hara@example.co",
    "NOME@EXEMPLO.COM",
    "joão@example.com",
    "usuario@exemplo.рф",
  ])("accepts the legitimate basic format %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    "",
    "usuario",
    "@gmail.com",
    "usuario@",
    "usuario dominio@example.com",
    "usuario@gmail com",
    "usuario@@example.com",
    "usuario@example",
    "usuario@.com",
    "usuario@gmail.",
    ".usuario@example.com",
    "usuario.@example.com",
    "usuario..teste@example.com",
    "usuario@dominio..com",
    "usuario@-dominio.com",
    "usuario@dominio-.com",
    "usuario@dominio.c",
  ])("rejects the evidently invalid format %s", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it.each([
    ["usuario@gamil.com", "usuario@gmail.com"],
    ["usuario@gmial.com", "usuario@gmail.com"],
    ["usuario@hotmial.com", "usuario@hotmail.com"],
    ["usuario@outlok.com", "usuario@outlook.com"],
    ["usuario@outllok.com", "usuario@outlook.com"],
    ["Usuario@GMIAL.COM", "Usuario@gmail.com"],
  ])("suggests the common correction for %s", (email, suggestion) => {
    expect(getEmailDomainSuggestion(email)).toBe(suggestion);
  });

  it("does not suggest changes for an unknown or correctly typed domain", () => {
    expect(getEmailDomainSuggestion("usuario@gmail.com")).toBeNull();
    expect(getEmailDomainSuggestion("usuario@empresa.com.br")).toBeNull();
    expect(getEmailDomainSuggestion("usuario..nome@gmial.com")).toBeNull();
    expect(getEmailDomainSuggestion("usuario@constructor")).toBeNull();
    expect(getEmailDomainSuggestion("usuario@__proto__")).toBeNull();
  });
});

describe("final signup credential validation", () => {
  it("returns normalized credentials only when email, password and confirmation are valid", () => {
    expect(validateSignupCredentials({
      email: "  Usuario@GMAIL.COM  ",
      password: "Sonhar@2026",
      confirmPassword: "Sonhar@2026",
    })).toMatchObject({
      normalizedEmail: "Usuario@gmail.com",
      emailValid: true,
      passwordsMatch: true,
      isValid: true,
    });
  });

  it.each([
    { email: "usuario gmail.com", password: "Sonhar@2026", confirmPassword: "Sonhar@2026" },
    { email: "usuario@gmail.com", password: "Sonhar2026", confirmPassword: "Sonhar2026" },
    { email: "usuario@gmail.com", password: "Sonhar@2026", confirmPassword: "sonhar@2026" },
    { email: "usuario@gmail.com", password: "", confirmPassword: "" },
  ])("blocks invalid credentials before signup: %o", (credentials) => {
    expect(validateSignupCredentials(credentials).isValid).toBe(false);
  });
});

describe("signup errors", () => {
  it("translates common auth failures without exposing technical details", () => {
    expect(getSignupErrorMessage(new Error("User already registered"))).toContain("entrar ou recuperar");
    expect(getSignupErrorMessage(new Error("User already registered"))).not.toContain("já está cadastrado");
    expect(getSignupErrorMessage(new Error("Failed to fetch"))).toContain("internet");
    expect(getSignupErrorMessage(new Error("Network error while checking password"))).toContain("internet");
    expect(getSignupErrorMessage(new Error("database constraint auth_42"))).not.toContain("constraint");
  });

  it("uses a safe message for password update failures", () => {
    expect(getPasswordUpdateErrorMessage(new Error("weak_password"))).toContain("requisitos");
    expect(getPasswordUpdateErrorMessage(new Error("New password should be different from old password"))).toContain("diferente");
    expect(getPasswordUpdateErrorMessage({ code: "same_password", message: "Auth error" })).toContain("diferente");
    expect(getPasswordUpdateErrorMessage(new Error("database auth failure"))).not.toContain("database");
  });

  it("translates login and password reset request failures", () => {
    expect(getLoginErrorMessage({ code: "invalid_credentials" })).toBe("E-mail ou senha incorretos.");
    expect(getLoginErrorMessage({ code: "email_not_confirmed" })).toContain("Confirme seu e-mail");
    expect(getPasswordResetRequestErrorMessage(new Error("Failed to fetch"))).toContain("internet");
    expect(getPasswordResetRequestErrorMessage(new Error("database auth failure"))).not.toContain("database");
  });
});
