import { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import {
  RuntimeErrorBoundary,
  RuntimeErrorFallback,
  normalizeRuntimeError,
} from "@/components/ErrorBoundary";
import WalletProviders from "./providers/WalletProviders";
import { logWalletConnection } from "@/lib/walletConnectionDebug";
import { resumeWalletConnectionFromUri } from "@/lib/reown";

const Index = lazy(() => import("./pages/Index.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const LearnMorePage = lazy(() => import("./pages/LearnMore.tsx"));
const AuthPages = lazy(() => import("./pages/Auth/index.tsx").then((module) => ({ default: module.AuthPages })));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx").then((module) => ({ default: module.Dashboard })));
const SendPage = lazy(() => import("./pages/Send.tsx").then((module) => ({ default: module.SendPage })));
const ReceivePage = lazy(() => import("./pages/Receive.tsx").then((module) => ({ default: module.ReceivePage })));
const TransactionsPage = lazy(() =>
  import("./pages/Transactions.tsx").then((module) => ({ default: module.TransactionsPage })),
);
const TransactionDetailPage = lazy(() =>
  import("./pages/Transactions.tsx").then((module) => ({ default: module.TransactionDetailPage })),
);
const SettingsPage = lazy(() => import("./pages/Settings.tsx").then((module) => ({ default: module.SettingsPage })));
const ScanPage = lazy(() => import("./pages/Scan.tsx").then((module) => ({ default: module.ScanPage })));
const AdminDashboard = lazy(() =>
  import("./pages/AdminDashboard.tsx").then((module) => ({ default: module.AdminDashboard })),
);
const WithdrawPage = lazy(() => import("./pages/Withdraw.tsx").then((module) => ({ default: module.default })));

const RouteLoadingFallback = () => (
  <div className="flex min-h-screen items-center justify-center px-6 text-center">
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-900">Loading OfflinePay...</p>
      <p className="text-sm text-slate-600">Preparing the next screen.</p>
    </div>
  </div>
);

const WalletCallbackRoute = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const walletConnectUri = searchParams.get("uri");

    logWalletConnection("wallet.callback.route.entered", {
      path: location.pathname,
      search: location.search,
      walletConnectUri,
      href: typeof window !== "undefined" ? window.location.href : null,
    });

    let cancelled = false;

    const resumeConnection = async () => {
      if (!walletConnectUri) {
        logWalletConnection("wallet.callback.route.missing-uri");
        return;
      }

      try {
        await resumeWalletConnectionFromUri(walletConnectUri);
        logWalletConnection("wallet.callback.route.resume.completed");
      } catch (error) {
        logWalletConnection("wallet.callback.route.resume.failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void resumeConnection();

    const timeout = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      logWalletConnection("wallet.callback.route.redirecting-home");
      navigate("/", { replace: true });
    }, walletConnectUri ? 2200 : 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [location.pathname, location.search, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-900">Finishing wallet connection...</p>
        <p className="text-sm text-slate-600">
          If your wallet approved the request, OfflinePay will reconnect and return you to the app.
        </p>
      </div>
    </div>
  );
};

const SafeRoute = ({
  children,
  routeName,
}: {
  children: React.ReactNode;
  routeName: string;
}) => {
  const location = useLocation();

  return (
    <RuntimeErrorBoundary
      description="This route failed to render. Navigation is still available, and the error is logged in the console."
      resetKey={`${routeName}:${location.pathname}`}
      scope={`route:${routeName}`}
      title={`${routeName} failed to render`}
    >
      <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
    </RuntimeErrorBoundary>
  );
};

const AppRoutes = () => {
  const location = useLocation();

  const renderSafeRoute = (routeName: string, element: React.ReactNode) => (
    <SafeRoute routeName={routeName}>{element}</SafeRoute>
  );

  useEffect(() => {
    console.log('[AppRoutes] route hit', { path: location.pathname });
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/" element={renderSafeRoute("Landing", <Index />)} />
      <Route path="/wc" element={renderSafeRoute("Wallet Callback", <WalletCallbackRoute />)} />
      <Route path="/learn-more" element={renderSafeRoute("Learn More", <LearnMorePage />)} />
      <Route path="/login" element={renderSafeRoute("Login Redirect", <Navigate to="/auth/login" replace />)} />
      <Route path="/signup" element={renderSafeRoute("Signup Redirect", <Navigate to="/auth/login" replace />)} />
      <Route path="/auth/*" element={renderSafeRoute("Auth", <AuthPages />)} />
      <Route
        path="/dashboard"
        element={renderSafeRoute("Dashboard", <ProtectedRoute><Dashboard /></ProtectedRoute>)}
      />
      <Route
        path="/send"
        element={renderSafeRoute("Send", <ProtectedRoute><SendPage /></ProtectedRoute>)}
      />
      <Route
        path="/receive"
        element={renderSafeRoute("Receive", <ProtectedRoute><ReceivePage /></ProtectedRoute>)}
      />
      <Route
        path="/withdraw"
        element={renderSafeRoute("Withdraw", <ProtectedRoute><WithdrawPage /></ProtectedRoute>)}
      />
      <Route
        path="/scan"
        element={renderSafeRoute("Scan", <ProtectedRoute><ScanPage /></ProtectedRoute>)}
      />
      <Route
        path="/transactions"
        element={renderSafeRoute("Transactions", <ProtectedRoute><TransactionsPage /></ProtectedRoute>)}
      />
      <Route
        path="/transactions/:txId"
        element={renderSafeRoute(
          "Transaction Detail",
          <ProtectedRoute><TransactionDetailPage /></ProtectedRoute>,
        )}
      />
      <Route
        path="/settings"
        element={renderSafeRoute("Settings", <ProtectedRoute><SettingsPage /></ProtectedRoute>)}
      />
      <Route
        path="/admin"
        element={renderSafeRoute("Admin", <AdminRoute><AdminDashboard /></AdminRoute>)}
      />
      <Route path="*" element={renderSafeRoute("Not Found", <NotFound />)} />
    </Routes>
  );
};

const AppContent = () => {
  const [globalRuntimeError, setGlobalRuntimeError] = useState<Error | null>(null);

  useEffect(() => {
    console.log("App mounted");

    const handleWindowError = (event: ErrorEvent) => {
      const error = normalizeRuntimeError(event.error ?? event.message);
      console.error("[App] Unhandled window error", error);
      setGlobalRuntimeError(error);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = normalizeRuntimeError(event.reason);
      console.error("[App] Unhandled promise rejection", error);
      setGlobalRuntimeError(error);
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  if (globalRuntimeError) {
    return (
      <RuntimeErrorFallback
        description="The app caught an unhandled runtime error outside the normal React render path. The details are shown below."
        error={globalRuntimeError}
        title="Unhandled runtime error"
      />
    );
  }

  return (
    <WalletProviders>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </WalletProviders>
  );
};

const App = () => (
  <RuntimeErrorBoundary
    description="The main application shell hit a runtime error. This fallback keeps the app visible instead of showing a blank page."
    scope="app"
    title="App failed to render"
  >
    <AppContent />
  </RuntimeErrorBoundary>
);

export default App;
