/** One icon per module — shown in a tile tinted with the module's accent (Home, module pages, the page breadcrumb). */
import {
  LayoutDashboard,
  Headset,
  Calculator,
  Users,
  Truck,
  Ticket,
  FileCheck2,
  BarChart3,
  ShieldHalf,
  Wrench,
  Stethoscope,
  Briefcase,
  Compass,
  Boxes,
  type LucideIcon,
} from "lucide-react";

const MODULE_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  csr: Headset,
  accounting: Calculator,
  hr: Users,
  parts: Truck,
  tickets: Ticket,
  claims: FileCheck2,
  report: BarChart3,
  admin: ShieldHalf,
  "branch-technician": Wrench,
  triage: Stethoscope,
  bizops: Briefcase,
  guides: Compass,
};

export function moduleIcon(slug: string): LucideIcon {
  return MODULE_ICONS[slug] ?? Boxes;
}
