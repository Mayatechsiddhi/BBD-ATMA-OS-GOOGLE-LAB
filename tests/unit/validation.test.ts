import { it, expect } from "vitest";
import {
  organizationInput,
  inviteInput,
  tokenInput,
} from "../../src/modules/organizations/validation";
import { readEnv } from "../../src/lib/env";
it("rejects invalid organization slugs and oversized names", () => {
  for (const slug of ["A tenant", "../admin", "a--b", "a"])
    expect(organizationInput.safeParse({ name: "Valid", slug }).success).toBe(
      false,
    );
  expect(
    organizationInput.safeParse({ name: "x".repeat(101), slug: "valid" })
      .success,
  ).toBe(false);
});
it("normalizes invitation emails and prevents owner invitations", () => {
  expect(
    inviteInput.parse({ email: "Person@Example.com", role: "ADMIN" }).email,
  ).toBe("person@example.com");
  expect(
    inviteInput.safeParse({ email: "a@example.com", role: "OWNER" }).success,
  ).toBe(false);
});
it("requires cryptographically sized invitation tokens", () => {
  expect(tokenInput.safeParse("abcd").success).toBe(false);
  expect(tokenInput.safeParse("a".repeat(64)).success).toBe(true);
});
it("validates configuration without exposing secret values", () => {
  expect(() => readEnv({ RUNTIME_DATABASE_URL: "sensitive-value" })).toThrow(
    "Invalid environment configuration",
  );
  try {
    readEnv({ RUNTIME_DATABASE_URL: "sensitive-value" });
  } catch (e) {
    expect(String(e)).not.toContain("sensitive-value");
  }
});
it("requires HTTPS in production", () => {
  expect(() =>
    readEnv({
      NODE_ENV: "production",
      RUNTIME_DATABASE_URL: "postgresql://localhost/bbd",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://example.com",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      SMTP_FROM: "a@example.com",
    }),
  ).toThrow("HTTPS");
});

it("validates production runtime configuration without migration credentials", () => {
  const valid = {
    NODE_ENV: "production",
    RUNTIME_DATABASE_URL: "postgresql://runtime@localhost/bbd",
    BETTER_AUTH_SECRET: "x".repeat(48),
    BETTER_AUTH_URL: "https://bbd.example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_FROM: "accounts@example.com",
    SMTP_USER: "fixture",
    SMTP_PASSWORD: "fixture",
  };
  expect(readEnv(valid).RUNTIME_DATABASE_URL).toBe(valid.RUNTIME_DATABASE_URL);
  const { RUNTIME_DATABASE_URL: omitted, ...rest } = valid;
  expect(omitted).toBeTruthy();
  expect(() =>
    readEnv({
      ...rest,
      DATABASE_URL: "postgresql://migration-owner@localhost/bbd",
    }),
  ).toThrow("RUNTIME_DATABASE_URL");
});
