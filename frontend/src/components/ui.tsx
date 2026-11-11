import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ Button */
type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary:
    "bg-indigo-strong text-white hover:bg-indigo-hover shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_8px_20px_-10px_var(--c-indigo)]",
  secondary: "bg-raised text-ink border border-line-strong hover:border-indigo/60 hover:bg-raised/80",
  ghost: "text-ink-2 hover:text-ink hover:bg-raised",
  danger: "bg-rose/10 text-rose border border-rose/30 hover:bg-rose/20",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ Panel */
export function Panel({ title, subtitle, actions, children, className, bodyClass }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx("panel min-w-0", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx("p-5", bodyClass)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ Stat */
export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "indigo" | "blue" | "violet" | "signal" | "amber" | "rose"; icon?: ReactNode }) {
  const toneCls = tone ? { indigo: "text-indigo", blue: "text-blue", violet: "text-violet", signal: "text-signal", amber: "text-amber", rose: "text-rose" }[tone] : "text-ink";
  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 text-[13px] text-muted">
        <span>{label}</span>
        {icon && <span className={clsx("opacity-80", toneCls)}>{icon}</span>}
      </div>
      <div className={clsx("num mt-1.5 text-[26px] font-semibold leading-none", toneCls)}>{value}</div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */
export function Badge({ tone = "muted", children, dot }: { tone?: "muted" | "indigo" | "blue" | "violet" | "signal" | "amber" | "rose"; children: ReactNode; dot?: boolean }) {
  const map = {
    muted: "bg-raised text-ink-2 border-line",
    indigo: "bg-indigo/10 text-indigo border-indigo/30",
    blue: "bg-blue/10 text-blue border-blue/30",
    violet: "bg-violet/10 text-violet border-violet/30",
    signal: "bg-signal/10 text-signal border-signal/30",
    amber: "bg-amber/10 text-amber border-amber/30",
    rose: "bg-rose/10 text-rose border-rose/30",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", map[tone])}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = { completed: "signal", running: "blue", queued: "indigo", failed: "rose", cancelled: "amber" }[status] as "signal";
  return (
    <Badge tone={tone ?? "muted"} dot>
      {status === "running" && <span className="sr-only">in progress:</span>}
      {status}
    </Badge>
  );
}

/* ------------------------------------------------------------------ Form controls */
export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-lg border border-line-strong bg-bg-2 px-3 text-sm text-ink placeholder:text-muted outline-none transition-colors focus:border-indigo focus-visible:outline-none focus:ring-2 focus:ring-indigo/30";

export function Select({ value, onChange, options, id, disabled, ariaLabel }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; id?: string; disabled?: boolean; ariaLabel?: string }) {
  return (
    <select id={id} aria-label={ariaLabel} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={clsx(inputCls, "pr-8")}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function NumberInput({ value, onChange, min, max, step, id, disabled, ariaLabel }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; id?: string; disabled?: boolean; ariaLabel?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  const invalid = text === "" || Number.isNaN(Number(text)) || (min != null && Number(text) < min) || (max != null && Number(text) > max);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="number"
      inputMode="decimal"
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      value={text}
      aria-invalid={invalid}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && !Number.isNaN(n) && (min == null || n >= min) && (max == null || n <= max)) onChange(n);
      }}
      className={clsx(inputCls, "num", invalid && "border-rose focus:border-rose focus:ring-rose/30")}
    />
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}

export function Slider({ value, onChange, min, max, step, id, label, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; id?: string; label: string; format?: (v: number) => string }) {
  return (
    <div className="flex items-center gap-3">
      <input id={id} aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1.5 w-full cursor-pointer" />
      <span className="num w-14 shrink-0 text-right text-sm font-medium text-ink">{format ? format(value) : value}</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex w-fit max-w-full flex-wrap self-start rounded-lg border border-line-strong bg-bg-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx("h-8 rounded-md px-3 text-[13px] font-medium transition-colors", value === o.value ? "bg-raised text-ink shadow-sm ring-1 ring-line-strong" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="group inline-flex items-center gap-2.5 text-sm text-ink-2">
      <span className={clsx("relative h-5 w-9 rounded-full border transition-colors", checked ? "border-indigo bg-indigo-strong" : "border-line-strong bg-bg-2")}>
        <span className={clsx("absolute top-0.5 size-3.5 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </span>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ Tip */
export function Tip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-muted hover:text-ink"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-line-strong bg-raised px-3 py-2 text-xs font-normal leading-relaxed text-ink-2 shadow-xl">
          {children}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ Progress / states */
export function Progress({ value, tone = "indigo", label }: { value: number; tone?: "indigo" | "violet" | "blue"; label: string }) {
  const color = { indigo: "bg-indigo", violet: "bg-violet", blue: "bg-blue" }[tone];
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
      <motion.div className={clsx("h-full rounded-full", color)} initial={false} animate={{ width: `${Math.max(2, value * 100)}%` }} transition={{ duration: 0.4 }} />
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl border border-line-strong bg-raised text-indigo">{icon}</div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-ink">
      <XCircle className="mt-0.5 size-4 shrink-0 text-rose" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Something went wrong</p>
        <p className="mt-0.5 break-words text-ink-2">{msg}</p>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Callout({ tone = "indigo", title, children }: { tone?: "indigo" | "amber" | "violet"; title?: string; children: ReactNode }) {
  const cls = { indigo: "border-indigo/30 bg-indigo/[0.07]", amber: "border-amber/30 bg-amber/[0.07]", violet: "border-violet/30 bg-violet/[0.07]" }[tone];
  const Icon = tone === "amber" ? AlertTriangle : Info;
  const ic = { indigo: "text-indigo", amber: "text-amber", violet: "text-violet" }[tone];
  return (
    <div className={clsx("flex gap-3 rounded-lg border px-4 py-3 text-[13px] leading-relaxed text-ink-2", cls)}>
      <Icon className={clsx("mt-0.5 size-4 shrink-0", ic)} aria-hidden />
      <div>
        {title && <p className="mb-0.5 font-medium text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Toasts */
type Toast = { id: number; tone: "success" | "error" | "info"; title: string; body?: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === "error" ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite" data-toasts="">
        <AnimatePresence>
          {items.map((t) => {
            const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? XCircle : Info;
            const c = t.tone === "success" ? "text-signal" : t.tone === "error" ? "text-rose" : "text-blue";
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24 }}
                className="pointer-events-auto flex gap-3 rounded-xl border border-line-strong bg-raised px-4 py-3 shadow-2xl"
                role={t.tone === "error" ? "alert" : "status"}
              >
                <Icon className={clsx("mt-0.5 size-4 shrink-0", c)} aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-ink">{t.title}</p>
                  {t.body && <p className="mt-0.5 break-words text-ink-2">{t.body}</p>}
                </div>
                <button aria-label="Dismiss notification" className="text-muted hover:text-ink" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
                  <X className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------------------ Confirm dialog */
export function Confirm({ open, title, body, confirmLabel, onConfirm, onClose, danger }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; danger?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-line-strong bg-surface p-6 shadow-2xl"
          >
            <h2 id="confirm-title" className="text-base font-semibold text-ink">
              {title}
            </h2>
            <div className="mt-2 text-sm leading-relaxed text-ink-2">{body}</div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Keep it
              </Button>
              <Button
                ref={ref}
                variant={danger ? "danger" : "primary"}
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ Tabs */
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="scrollbar-thin relative flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx("relative -mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors", value === t.value ? "border-indigo text-ink" : "border-transparent text-muted hover:text-ink")}
        >
          {t.label}
          {t.count != null && <span className="num ml-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Key/value list */
export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="num min-w-0 break-words text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
