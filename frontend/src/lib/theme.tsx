import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "dark" | "light";
const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "dark", setTheme: () => undefined });

function readStored(): Theme {
  try {
    const v = localStorage.getItem("umbra-theme");
    return v === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStored);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("umbra-theme", theme);
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  }, [theme]);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Chart colours resolved from CSS variables so charts follow the active theme. */
export function useChartColors() {
  const { theme } = useTheme();
  const [c, setC] = useState(() => read());
  useEffect(() => {
    setC(read());
  }, [theme]);
  return c;
}

function read() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim() || "#888";
  return {
    indigo: v("--c-indigo"),
    blue: v("--c-blue"),
    violet: v("--c-violet"),
    signal: v("--c-signal"),
    amber: v("--c-amber"),
    rose: v("--c-rose"),
    muted: v("--c-muted"),
    line: v("--c-line"),
    text: v("--c-text"),
    surface: v("--c-raised"),
  };
}
