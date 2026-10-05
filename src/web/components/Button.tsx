import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "brand" | "primary" | "secondary" | "danger";
  size?: "md" | "lg";
  icon?: LucideIcon;
};

const variants = {
  brand: "bg-brand text-white shadow-lg shadow-purple-500/20 hover:brightness-110",
  primary: "bg-blue-600 text-white hover:bg-blue-500",
  secondary: "bg-slate-200 text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600",
  danger: "bg-red-600 text-white hover:bg-red-500",
};
const sizes = { md: "h-12 px-5 text-base", lg: "h-14 px-7 text-lg" };

export function Button({ variant = "primary", size = "md", icon: Icon, className = "", children, ...rest }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={size === "lg" ? 24 : 20} aria-hidden />}
      {children}
    </button>
  );
}
