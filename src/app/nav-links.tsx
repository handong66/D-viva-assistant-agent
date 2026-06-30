"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: IconName };
type IconName = "today" | "plan" | "materials" | "practice" | "review" | "import" | "library";

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="mt-8 flex flex-col gap-1">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={`nav-link ${active ? "nav-link-active" : ""}`}>
            <span className="nav-icon" aria-hidden>
              <NavIcon name={item.icon} />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function NavIcon({ name }: { name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (name) {
    case "today":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" {...common}>
          <path d="M4 11.5 12 5l8 6.5" />
          <path d="M6.5 10.5V19h11v-8.5" />
          <path d="M10 19v-5h4v5" />
        </svg>
      );
    case "plan":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" {...common}>
          <path d="M7 4v3M17 4v3M5 8h14" />
          <rect x="5" y="5" width="14" height="15" rx="2" />
          <path d="M8 12h5M8 16h8" />
        </svg>
      );
    case "materials":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" {...common}>
          <path d="M4 7.5h6l2 2H20V19H4z" />
          <path d="M4 7.5V5h6l2 2h8v2.5" />
        </svg>
      );
    case "practice":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" {...common}>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="3" />
          <path d="m17 7 3-3M19 4h1v1" />
        </svg>
      );
    case "review":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" {...common}>
          <path d="M5 19V9M10 19V5M15 19v-7M20 19V8" />
          <path d="M4 19h17" />
        </svg>
      );
    case "import":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" {...common}>
          <path d="M12 4v10" />
          <path d="m8 10 4 4 4-4" />
          <path d="M5 18h14" />
        </svg>
      );
    case "library":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </svg>
      );
  }
}
