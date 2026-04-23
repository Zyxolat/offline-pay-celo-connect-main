import "@testing-library/jest-dom";
import { vi } from "vitest";

vi.stubEnv("VITE_WALLETCONNECT_PROJECT_ID", "test-reown-project-id");

const reownOpenMock = vi.fn(async () => undefined);
const reownCreateAppKitMock = vi.fn(() => ({
  open: reownOpenMock,
  close: vi.fn(),
}));

vi.mock("@reown/appkit/react", () => ({
  createAppKit: reownCreateAppKitMock,
  useAppKit: () => ({
    open: reownOpenMock,
    close: vi.fn(),
  }),
  useAppKitEvents: () => ({ data: null }),
  useAppKitState: () => ({
    open: false,
    connectingWallet: null,
    activeChain: null,
    loading: false,
    initialized: true,
  }),
}));

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

const shouldSuppressConsoleMessage = (value: unknown) => {
  const message = typeof value === "string" ? value : value instanceof Error ? value.message : String(value ?? "");

  return [
    "AppKit:getUniversalProvider",
    "Failed to fetch remote project configuration",
    "Failed to fetch usage",
    "Error checking Cross-Origin-Opener-Policy",
    "Lit is in dev mode",
    "[AppRoutes] route hit",
    "App mounted",
    "[AuthSelection] mounted",
    "[Login] mounted",
    "React Router Future Flag Warning",
  ].some((needle) => message.includes(needle));
};

console.error = (...args: unknown[]) => {
  if (args.some(shouldSuppressConsoleMessage)) {
    return;
  }

  originalConsoleError(...args);
};

console.warn = (...args: unknown[]) => {
  if (args.some(shouldSuppressConsoleMessage)) {
    return;
  }

  originalConsoleWarn(...args);
};

console.log = (...args: unknown[]) => {
  if (args.some(shouldSuppressConsoleMessage)) {
    return;
  }

  originalConsoleLog(...args);
};

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  root = null;
  rootMargin = "";
  thresholds = [];
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: IntersectionObserverMock,
});
