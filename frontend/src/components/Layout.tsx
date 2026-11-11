import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronsLeft,
  Database,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Moon,
  Network,
  ScanSearch,
  Settings,
  ShieldHalf,
  Sun,
  Swords,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

export const NAV = [
  { group: "Workspace", items: [{ to: "/", label: "Overview", icon: LayoutDashboard }] },
  {
    group: "Data",
    items: [
      { to: "/datasets", label: "Dataset Studio", icon: Database },
      { to: "/inspector", label: "Privacy Inspector", icon: ScanSearch },
    ],
  },
  {
    group: "Privacy engines",
    items: [
      { to: "/dp", label: "Differential Privacy", icon: ShieldHalf },
      { to: "/federated", label: "Federated Learning", icon: Network },
      { to: "/attacks", label: "Attack Laboratory", icon: Swords },
    ],
  },
  {
    group: "Results",
    items: [
      { to: "/experiments", label: "Model Experiments", icon: FlaskConical },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    group: "System",
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/docs", label: "Documentation", icon: BookOpen },
    ],
  },
];

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="url(#bm)" />
      <path d="M16 5.5 25 9v7.2c0 5.3-3.7 9.2-9 10.8-5.3-1.6-9-5.5-9-10.8V9l9-3.5Z" stroke="#A9A8FF" strokeWidth="1.6" />
      <path d="M16 10.5a5.5 5.5 0 1 0 0 11" stroke="#7DBBFF" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 10.5a5.5 5.5 0 0 1 0 11" stroke="#7DBBFF" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="1.5 2.2" />
      <circle cx="16" cy="16" r="1.8" fill="#C9AEFF" />
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#1B1F4A" />
          <stop offset="1" stopColor="#2A1E5C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function JobIndicator() {
  const { data } = useQuery({ queryKey: ["experiments"], queryFn: () => api.experiments(), refetchInterval: 3000 });
  const running = (data ?? []).filter((e) => e.status === "running" || e.status === "queued");
  if (!running.length) return null;
  const top = running[0];
  return (
    <NavLink to={`/experiments?id=${top.id}`} className="hidden items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 px-3 py-1.5 text-[13px] text-blue sm:flex">
      <Activity className="size-3.5 animate-pulse" aria-hidden />
      <span className="max-w-[220px] truncate">
        {running.length > 1 ? `${running.length} jobs running` : `${top.name} · ${Math.round(top.progress * 100)}%`}
      </span>
    </NavLink>
  );
}

function SideNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
      {NAV.map((g) => (
        <div key={g.group} className="mt-4 first:mt-2">
          {!collapsed && <p className="px-3 pb-1.5 text-xs font-medium text-muted">{g.group}</p>}
          <ul className="space-y-0.5">
            {g.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === "/"}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      "group relative flex h-8 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                      collapsed && "justify-center px-0",
                      isActive ? "bg-indigo/12 text-ink" : "text-ink-2 hover:bg-raised hover:text-ink",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute left-0 top-1.5 h-5 w-[3px] rounded-r bg-indigo" aria-hidden />}
                      <Icon className={clsx("size-[18px] shrink-0", isActive ? "text-indigo" : "text-muted group-hover:text-ink-2")} aria-hidden />
                      {!collapsed && <span className="truncate">{label}</span>}
                      {isActive && <span className="sr-only">(current page)</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("privora-nav") === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const loc = useLocation();
  useEffect(() => {
    try {
      localStorage.setItem("privora-nav", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollTo, and React would
    // treat any returned value as a cleanup function (crash on the next navigation).
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  const brand = (
    <div className={clsx("flex h-16 shrink-0 items-center gap-3 px-5", collapsed && "justify-center px-0")}>
      <BrandMark className="size-8 shrink-0" />
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-ink">Privora</p>
          <p className="text-xs text-muted">Privacy-preserving ML</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="app-backdrop min-h-full">
      <a href="#main" className="sr-only z-[200] rounded bg-indigo px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className={clsx("fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-bg/85 backdrop-blur-xl transition-[width] duration-200 lg:flex", collapsed ? "w-[72px]" : "w-[252px]")}>
        {brand}
        <SideNav collapsed={collapsed} />
        <div className="shrink-0 border-t border-line p-3">
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={clsx("flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted hover:bg-raised hover:text-ink", collapsed && "justify-center px-0")}
          >
            <ChevronsLeft className={clsx("size-[18px] transition-transform", collapsed && "rotate-180")} aria-hidden />
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[272px] flex-col border-r border-line bg-bg">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-muted hover:text-ink">
                <X className="size-5" />
              </button>
            </div>
            <SideNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className={clsx("transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[252px]")}>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur-xl sm:px-6">
          <button aria-label="Open navigation" className="rounded-lg p-2 text-ink-2 hover:bg-raised lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <BrandMark className="size-7" />
            <span className="font-semibold">Privora</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <JobIndicator />
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              className="grid size-9 place-items-center rounded-lg border border-line text-ink-2 hover:border-line-strong hover:text-ink"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, icon }: { title: string; description: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        <div className="flex items-center gap-3">
          {icon && <span className="grid size-9 place-items-center rounded-lg border border-line-strong bg-raised text-indigo">{icon}</span>}
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
