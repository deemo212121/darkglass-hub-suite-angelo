// Thin wrapper around TicketsMapWorkMap. The full standalone map component
// was retired in favour of the shared Work-Map implementation; this file
// stays only to preserve the module-export name in case any external
// consumer still references it. See TicketsMapWorkMap.tsx for the real
// implementation.
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { TicketsMapWorkMap } from "@/components/TicketsMapWorkMap";

export function TicketsMap({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  return <TicketsMapWorkMap mod={mod} sub={sub} />;
}

export default TicketsMap;
