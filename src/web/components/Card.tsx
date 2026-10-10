import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function Card({ title, icon: Icon, tone = "light", className = "", style, children }: {
  title?: string; icon?: LucideIcon; tone?: "light" | "dark"; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  const base = tone === "dark" ? "bg-slate-800 text-slate-100 border-slate-700" : "bg-white text-slate-900 border-slate-200";
  return (
    <section className={`rounded-2xl border p-5 shadow-sm ${base} ${className}`} style={style}>
      {title && (
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide opacity-70">
          {Icon && <Icon size={16} aria-hidden />}{title}
        </h2>
      )}
      {children}
    </section>
  );
}
