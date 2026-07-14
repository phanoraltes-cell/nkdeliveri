import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export type BreadcrumbItem = { label: string; to?: string };

/**
 * Visual breadcrumb trail. Purely presentational — pair it with the
 * matching BreadcrumbList JSON-LD (see lib/seo.ts) on the same page so
 * search engines and users see the same hierarchy.
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Fil Ariane" className="mb-3 text-xs text-ink-soft">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={item.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-ink-soft/60" />}
              {item.to && !isLast ? (
                <Link to={item.to} className="hover:text-brand-deep hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "font-semibold text-ink" : ""}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
