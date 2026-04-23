import "./setup";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import App from "../App";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("App smoke", () => {
  const seedUserSession = () => {
    sessionStorage.setItem("sessionToken", "test-session-token");
    sessionStorage.setItem(
      "user",
      JSON.stringify({
        id: "user-1",
        email: "demo@example.com",
        role: "user",
      }),
    );
  };

  it("renders the landing page without crashing", async () => {
    window.history.pushState({}, "", "/");

    const view = render(<App />);

    expect(await view.findByText(/offline payments on celo/i)).toBeInTheDocument();
    expect(view.getByRole("heading", { name: /send payments/i })).toBeInTheDocument();
  });

  it("renders the login page without crashing", async () => {
    window.history.pushState({}, "", "/auth/login");

    const view = render(<App />);

    expect(await view.findByText(/welcome back/i)).toBeInTheDocument();
    expect(view.getByRole("button", { name: /continue with passkey/i })).toBeInTheDocument();
  });

  it("renders the learn more page without crashing", async () => {
    window.history.pushState({}, "", "/learn-more");

    const view = render(<App />);

    expect(await view.findByText(/offlinepay explainer/i)).toBeInTheDocument();
    expect(view.getByRole("heading", { name: /crypto payments that keep moving/i })).toBeInTheDocument();
  });

  it("renders the admin entry page without crashing", async () => {
    window.history.pushState({}, "", "/admin");

    const view = render(<App />);

    expect(await view.findByText(/admin login/i)).toBeInTheDocument();
    expect(view.getByRole("button", { name: /sign in as admin/i })).toBeInTheDocument();
  });

  it("falls back to login when the stored user payload is corrupted", async () => {
    sessionStorage.setItem("sessionToken", "test-session-token");
    sessionStorage.setItem("user", "{broken-json");
    window.history.pushState({}, "", "/dashboard");

    const view = render(<App />);

    expect(await view.findByText(/welcome back/i)).toBeInTheDocument();
    expect(sessionStorage.getItem("sessionToken")).toBeNull();
    expect(sessionStorage.getItem("user")).toBeNull();
  });

  it("renders the send page even with a corrupted offline wallet key", async () => {
    seedUserSession();
    localStorage.setItem("offlinePay_local_wallet_private_key", "not-a-private-key");
    window.history.pushState({}, "", "/send");

    const view = render(<App />);

    expect(await view.findByText(/create a time-locked offline payment/i)).toBeInTheDocument();
  });
});
