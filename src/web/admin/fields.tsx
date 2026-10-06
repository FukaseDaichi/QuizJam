import type { ReactNode } from "react";

export const inputClass =
  "mt-1 h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/30 disabled:opacity-40";

export const textareaClass =
  "mt-1 w-full resize-none rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/30";

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm font-bold text-slate-300 ${className}`}>
      {label}
      {hint && <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span>}
      {children}
    </label>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{children}</h3>;
}
