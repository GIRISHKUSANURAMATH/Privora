import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner, ToastProvider } from "./components/ui";
import { ThemeProvider } from "./lib/theme";
import "./index.css";

const Overview = lazy(() => import("./pages/Overview"));
const DatasetStudio = lazy(() => import("./pages/DatasetStudio"));
const PrivacyInspector = lazy(() => import("./pages/PrivacyInspector"));
const DPStudio = lazy(() => import("./pages/DPStudio"));
const FederatedStudio = lazy(() => import("./pages/FederatedStudio"));
const AttackLab = lazy(() => import("./pages/AttackLab"));
const Experiments = lazy(() => import("./pages/Experiments"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const Docs = lazy(() => import("./pages/Docs"));

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 2000 } } });

const wrap = (el: React.ReactNode) => <Suspense fallback={<Spinner label="Loading page" />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: wrap(<Overview />) },
      { path: "/datasets", element: wrap(<DatasetStudio />) },
      { path: "/inspector", element: wrap(<PrivacyInspector />) },
      { path: "/dp", element: wrap(<DPStudio />) },
      { path: "/federated", element: wrap(<FederatedStudio />) },
      { path: "/attacks", element: wrap(<AttackLab />) },
      { path: "/experiments", element: wrap(<Experiments />) },
      { path: "/analytics", element: wrap(<Analytics />) },
      { path: "/reports", element: wrap(<Reports />) },
      { path: "/settings", element: wrap(<Settings />) },
      { path: "/docs", element: wrap(<Docs />) },
      { path: "*", element: wrap(<Overview />) },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
