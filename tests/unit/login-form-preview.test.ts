import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));

const PREVIEW_LABEL = "Continue as the preview test account";

describe("login form preview sign-in", () => {
  it("shows no preview control on a normal deployment", () => {
    const markup = renderToStaticMarkup(createElement(LoginForm));
    expect(markup).not.toContain(PREVIEW_LABEL);
    expect(markup).toContain("Sign in");
  });

  it("shows the preview control only when the server opened the gate", () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, { previewLogin: true }));
    expect(markup).toContain(PREVIEW_LABEL);
    expect(markup).toContain("Preview deployment only");
  });
});
