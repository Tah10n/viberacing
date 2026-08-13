import Link from "next/link";
import type { ReactNode } from "react";

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
        <p className="eyebrow">{eyebrow}</p>
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
}

export function Panel({ children, className }: PanelProps) {
  return (
    <section className={`panel${className === undefined ? "" : ` ${className}`}`}>
      {children}
    </section>
  );
}

interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: "accent" | "success";
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
