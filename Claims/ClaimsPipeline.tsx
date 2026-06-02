import { useMemo, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ArrowRight, CheckCircle2, Clock, AlertCircle, ChevronLeft } from "lucide-react";
import { getSubModule } from "@/lib/modules";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

interface PipelineStage {
  stage: string;
  count: number;
  avgTime: number;
  records: any[];
}

export function ClaimsPipeline({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [filter, setFilter] = useState<string>("all");
  const [isReady, setIsReady] = useState(false);

  // Initialize data if not present
  useEffect(() => {
    const key = "claims-tracking";
    const existing = localStorage.getItem(key);
    if (!existing) {
      const sub = getSubModule("claims", "claims-tracking");
      if (sub && sub.seed) {
        const count = sub.count || 20;
        const data = Array.from({ length: count }, (_, i) => sub.seed(i));
        localStorage.setItem(key, JSON.stringify(data));
      }
    }
    setIsReady(true);
  }, []);

  const stages: PipelineStage[] = useMemo(() => {
    const data = JSON.parse(localStorage.getItem("claims-tracking") || "[]");
    const stageMap = new Map<string, any[]>();
    
    data.forEach((record: any) => {
      const stage = record.stage || "Submitted";
      if (!stageMap.has(stage)) stageMap.set(stage, []);
      stageMap.get(stage)!.push(record);
    });

    const stageOrder = ["Submitted", "Review", "Approved", "Denied", "Paid"];
    return stageOrder
      .map((stage) => {
        const records = stageMap.get(stage) || [];
        const avgTime =
          records.length > 0
            ? Math.round(
                records.reduce((sum: number, r: any) => sum + (r.ageDays || 0), 0) /
                  records.length
              )
            : 0;
        return { stage, count: records.length, avgTime, records };
      })
      .filter((s) => s.count > 0);
  }, []);

  const stageIcons: Record<string, any> = {
    Submitted: Clock,
    Review: AlertCircle,
    Approved: CheckCircle2,
    Denied: AlertCircle,
    Paid: CheckCircle2,
  };

  const stageColors: Record<string, string> = {
    Submitted: "bg-blue-50 border-blue-200",
    Review: "bg-amber-50 border-amber-200",
    Approved: "bg-green-50 border-green-200",
    Denied: "bg-red-50 border-red-200",
    Paid: "bg-green-50 border-green-200",
  };

  const stageBadgeColors: Record<string, string> = {
    Submitted: "bg-blue-100 text-blue-800",
    Review: "bg-amber-100 text-amber-800",
    Approved: "bg-green-100 text-green-800",
    Denied: "bg-red-100 text-red-800",
    Paid: "bg-green-100 text-green-800",
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
          <p className="text-gray-500">Loading pipeline...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pipeline Overview */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
            {stages.map((stage, idx) => {
              const Icon = stageIcons[stage.stage];
              return (
            <Card
              key={stage.stage}
              className={`p-4 border-2 cursor-pointer transition-all ${
                filter === stage.stage || filter === "all"
                  ? stageColors[stage.stage]
                  : "opacity-50"
              }`}
              onClick={() => setFilter(filter === stage.stage ? "all" : stage.stage)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-600">{stage.stage}</p>
                  <p className="text-2xl font-bold mt-1">{stage.count}</p>
                </div>
                <Icon className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-xs text-gray-500">
                {stage.avgTime}d avg
              </p>
              {idx < stages.length - 1 && (
                <ArrowRight className="w-4 h-4 text-gray-300 mt-2" />
              )}
            </Card>
              );
            })}
          </div>

          {/* Detailed Records */}
          {filter !== "all" && (
            <Card className="p-6">
              <h3 className="font-semibold mb-4">{filter} Claims</h3>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {stages
                  .find((s) => s.stage === filter)
                  ?.records.map((record, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${stageColors[filter]} flex items-start justify-between`}
                    >
                      <div className="flex-1">
                        <p className="font-medium">{record.id}</p>
                        <p className="text-sm text-gray-600">Owner: {record.owner}</p>
                        <p className="text-xs text-gray-500">{record.ageDays} days old</p>
                      </div>
                      <Badge className={stageBadgeColors[filter]}>{filter}</Badge>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          {/* Summary Stats */}
          <Card className="p-6 bg-gradient-to-br from-slate-50 to-slate-100">
            <h3 className="font-semibold mb-4">Pipeline Metrics</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Total Claims</p>
                <p className="text-2xl font-bold">
                  {stages.reduce((sum, s) => sum + s.count, 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Average Age</p>
                <p className="text-2xl font-bold">
                  {Math.round(
                    stages.reduce((sum, s) => sum + s.avgTime * s.count, 0) /
                      stages.reduce((sum, s) => sum + s.count, 1)
                  )}d
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Approval Rate</p>
                <p className="text-2xl font-bold">
                  {Math.round(
                    ((stages.find((s) => s.stage === "Approved")?.count || 0) /
                      Math.max(stages.reduce((sum, s) => sum + s.count, 0), 1)) *
                      100
                  )}%
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
