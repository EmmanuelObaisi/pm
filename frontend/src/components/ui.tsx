"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const VARIANTS = {
  primary: "bg-[var(--primary-blue)] text-white hover:brightness-110",
  secondary:
    "bg-white text-[var(--navy-dark)] border border-[var(--stroke)] hover:bg-[var(--surface)]",
  ghost: "text-[var(--gray-text)] hover:text-[var(--navy-dark)] hover:bg-[var(--surface)]",
  danger: "bg-red-600 text-white hover:brightness-110",
};

export const Button = ({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) => (
  <button
    {...props}
    className={clsx(
      "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition",
      "disabled:cursor-not-allowed disabled:opacity-50",
      size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm",
      VARIANTS[variant],
      className
    )}
  />
);

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={clsx(
      "w-full rounded-lg border border-[var(--stroke)] bg-white px-3 py-2 text-sm",
      "outline-none focus:border-[var(--primary-blue)]",
      className
    )}
  />
);

export const Field = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <label className="flex flex-col gap-1.5 text-sm">
    <span className="font-medium text-[var(--navy-dark)]">{label}</span>
    {children}
  </label>
);

export const ErrorText = ({ children }: { children: ReactNode }) =>
  children ? (
    <p role="alert" className="text-sm text-red-600">
      {children}
    </p>
  ) : null;

export const Spinner = ({ label = "Loading" }: { label?: string }) => (
  <div role="status" className="flex items-center gap-2 text-sm text-[var(--gray-text)]">
    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--stroke)] border-t-[var(--primary-blue)]" />
    {label}
  </div>
);

export const EmptyState = ({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--stroke)] px-6 py-10 text-center">
    <p className="font-display text-base font-semibold">{title}</p>
    {hint ? <p className="max-w-sm text-sm text-[var(--gray-text)]">{hint}</p> : null}
    {action}
  </div>
);

export const Badge = ({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) => (
  <span
    className={clsx(
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
      className
    )}
    style={color ? { backgroundColor: `${color}22`, color } : undefined}
  >
    {children}
  </span>
);

export const Modal = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
    <div
      role="dialog"
      aria-label={title}
      className="w-full max-w-md rounded-2xl bg-white p-6 shadow-[var(--shadow)]"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          Close
        </Button>
      </div>
      {children}
    </div>
  </div>
);
