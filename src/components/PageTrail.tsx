/**
 * Slim strip above every module page: the module's icon in its accent
 * colour, then Home › Module › Page (each part clickable), and a red badge
 * when something on this page is waiting on the viewer (useAttention).
 * Pages keep their own titles and back buttons — this only adds where-am-I.
 */
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { moduleIcon } from "@/lib/moduleIcons";
import { useAttention, badgeText } from "@/lib/attention";

export function PageTrail({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const Icon = moduleIcon(mod.slug);
  const waiting = useAttention()?.pageCounts[`${mod.slug}/${sub.slug}`] ?? 0;
  return (
    <nav className="page-trail" aria-label="Breadcrumb" style={{ ["--accent" as string]: mod.accent }}>
      <div className="page-trail-inner">
        <span className="page-trail-icon" aria-hidden>
          <Icon />
        </span>
        <Link to="/home" className="page-trail-link">
          Home
        </Link>
        <ChevronRight className="page-trail-sep" aria-hidden />
        <Link to="/m/$module" params={{ module: mod.slug }} className="page-trail-link">
          {mod.label}
        </Link>
        <ChevronRight className="page-trail-sep" aria-hidden />
        <span className="page-trail-current" aria-current="page">
          {sub.title}
        </span>
        {waiting > 0 && (
          <span className="home-badge home-badge--sm" title={`${waiting} waiting on you on this page`}>
            {badgeText(waiting)}
          </span>
        )}
      </div>
    </nav>
  );
}
