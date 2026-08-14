import Link from "next/link";
import type { ReactNode } from "react";

interface PageShellProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly width?: "narrow" | "wide";
}

export function PageShell({ children, className, width = "wide" }: PageShellProps) {
  const classes = ["page-shell", `page-shell-${width}`, className].filter(Boolean).join(" ");
  return <main className={classes}>{children}</main>;
}

interface PageHeaderProps {
  readonly action?: ReactNode;
  readonly description?: ReactNode;
  readonly eyebrow: string;
  readonly title: ReactNode;
}

export function PageHeader({ action, description, eyebrow, title }: PageHeaderProps) {
  return (
    <header className={`page-heading${action === undefined ? "" : " page-heading-with-action"}`}>
      <div>
        <p className="eyebrow meta-label">{eyebrow}</p>
        <h1>{title}</h1>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

interface PanelProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly id?: string;
}

export function Panel({ children, className, id }: PanelProps) {
  return (
    <section className={`panel${className === undefined ? "" : ` ${className}`}`} id={id}>
      {children}
    </section>
  );
}

interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: "accent" | "success" | "neutral" | "warning";
}

export function Badge({ children, tone = "accent" }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

interface ActionLinkProps {
  readonly children: ReactNode;
  readonly href: string;
  readonly variant?: "primary" | "secondary";
}

export function ActionLink({ children, href, variant = "primary" }: ActionLinkProps) {
  return (
    <Link className={variant === "primary" ? "button" : "button button-secondary"} href={href}>
      {children}
    </Link>
  );
}
