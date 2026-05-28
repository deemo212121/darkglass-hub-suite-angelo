import { useMemo, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { MapPin, Zap, AlertTriangle, CheckCircle, ChevronLeft } from "lucide-react";
import { getSubModule } from "@/lib/modules";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface LocationTickets {
  location: string;
  count: number;
  records: any[];
  priority: "high" | "medium" | "low";
}

export function TicketsMap({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Initialize data if not present
  useEffect(() => {
    const key = "ticket-list";
    const existing = localStorage.getItem(key);
    if (!existing) {
      const sub = getSubModule("tickets", "ticket-list");
      if (sub && sub.seed) {
        const count = sub.count || 24;
        const data = Array.from({ length: count }, (_, i) => sub.seed(i));
        localStorage.setItem(key, JSON.stringify(data));
      }
    }
    setIsReady(true);
  }, []);

  const locationData: LocationTickets[] = useMemo(() => {
    const data = JSON.parse(localStorage.getItem("ticket-list") || "[]");
    const locationMap = new Map<string, any[]>();

    data.forEach((record: any) => {
      const loc = record.location || "Richmond, VA";
      if (!locationMap.has(loc)) locationMap.set(loc, []);
      locationMap.get(loc)!.push(record);
    });

    return Array.from(locationMap.entries())
      .map(([location, records]) => {
        const highPriority = records.filter(
          (r: any) => r.priority === "High"
        ).length;
        const priority: "high" | "medium" | "low" =
          highPriority > 0 ? "high" : records.length > 3 ? "medium" : "low";
        return { location, count: records.length, records, priority };
      })
      .sort((a, b) => b.count - a.count);
  }, []);

  const priorityColors: Record<"high" | "medium" | "low", string> = {
    high: "bg-red-50 border-red-200",
    medium: "bg-amber-50 border-amber-200",
    low: "bg-green-50 border-green-200",
  };

  const priorityBadgeColors: Record<"high" | "medium" | "low", string> = {
    high: "bg-red-100 text-red-800",
    medium: "bg-amber-100 text-amber-800",
    low: "bg-green-100 text-green-800",
  };

  const priorityLabels: Record<"high" | "medium" | "low", string> = {
    high: "High Priority",
    medium: "Medium Priority",
    low: "Low Priority",
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <div>
            <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
            <p className="text-lg text-muted-foreground">{sub.description}</p>
          </div>
        </div>
      {!isReady ? (
        <div className="flex justify-center items-center h-96">
          <p className="text-gray-500">Loading ticket map...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Map Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {locationData.map((loc) => (
              <Card
                key={loc.location}
            className={`p-4 border-2 cursor-pointer transition-all hover:shadow-lg ${
              priorityColors[loc.priority]
            } ${
              selectedLocation === loc.location ? "ring-2 ring-blue-500" : ""
            }`}
            onClick={() =>
              setSelectedLocation(
                selectedLocation === loc.location ? null : loc.location
              )
            }
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                <div>
                  <p className="font-semibold text-sm">{loc.location}</p>
                  <Badge className={priorityBadgeColors[loc.priority]}>
                    {priorityLabels[loc.priority]}
                  </Badge>
                </div>
              </div>
              <span className="text-2xl font-bold text-gray-700">
                {loc.count}
              </span>
            </div>

            {/* Status breakdown */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-gray-600">Open</p>
                <p className="font-semibold">
                  {loc.records.filter((r: any) => r.status === "Open").length}
                </p>
              </div>
              <div>
                <p className="text-gray-600">Closed</p>
                <p className="font-semibold">
                  {loc.records.filter((r: any) => r.status === "Closed").length}
                </p>
              </div>
            </div>
          </Card>
            ))}
          </div>

          {/* Details Panel */}
          {selectedLocation && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  {selectedLocation}
                </h3>
                <button
                  onClick={() => setSelectedLocation(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {locationData
              .find((l) => l.location === selectedLocation)
              ?.records.map((ticket, idx) => {
                const statusIcon =
                  ticket.status === "Closed" ? (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  );
                const priorityIcon =
                  ticket.priority === "High" ? (
                    <Zap className="w-4 h-4 text-red-600" />
                  ) : null;

                return (
                  <div
                    key={idx}
                    className="p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {statusIcon}
                        <p className="font-medium text-sm">{ticket.id}</p>
                        {priorityIcon && priorityIcon}
                      </div>
                      <Badge variant="outline">{ticket.status}</Badge>
                    </div>
                    <p className="text-xs text-gray-600 mb-1">
                      Service: {ticket.appliance}
                    </p>
                    <p className="text-xs text-gray-500">
                      Technician: {ticket.technician}
                    </p>
                  </div>
                );
              })}
          </div>

          {/* Summary */}
          <div className="mt-4 pt-4 border-t grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-600">Total</p>
              <p className="font-semibold text-lg">
                {
                  locationData.find((l) => l.location === selectedLocation)
                    ?.count
                }
              </p>
            </div>
            <div>
              <p className="text-gray-600">Open</p>
              <p className="font-semibold text-lg">
                {
                  locationData
                    .find((l) => l.location === selectedLocation)
                    ?.records.filter((r: any) => r.status === "Open").length
                }
              </p>
            </div>
            <div>
              <p className="text-gray-600">Closed Today</p>
              <p className="font-semibold text-lg">
                {
                  locationData
                    .find((l) => l.location === selectedLocation)
                    ?.records.filter(
                      (r: any) => r.status === "Closed"
                    ).length
                }
              </p>
            </div>
          </div>
        </Card>
          )}

          {/* Summary Stats */}
          <Card className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50">
            <h3 className="font-semibold mb-4">Network Overview</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-600">Locations</p>
                <p className="text-2xl font-bold">{locationData.length}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Tickets</p>
                <p className="text-2xl font-bold">
                  {locationData.reduce((sum, l) => sum + l.count, 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">High Priority</p>
                <p className="text-2xl font-bold">
                  {locationData.filter((l) => l.priority === "high").length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Avg per Location</p>
                <p className="text-2xl font-bold">
                  {Math.round(
                    locationData.reduce((sum, l) => sum + l.count, 0) /
                      Math.max(locationData.length, 1)
                  )}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
      </main>
    </div>
  );
}
