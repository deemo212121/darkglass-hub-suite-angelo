import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getModule, getSubModule } from "@/lib/modules";
import { getUserManagementRecord } from "@/lib/user-management";

const TABS = [
  "General Information",
  "Work Plan",
  "Billing Information",
  "Account Information",
  "Vehicle Information",
  "Employee Information",
] as const;

export const Route = createFileRoute("/m/$module/$submodule/$userId")({
  ssr: false,
  loader: ({ params }) => {
    const module = getModule(params.module);
    const submodule = getSubModule(params.module, params.submodule);
    const user = getUserManagementRecord(params.userId);
    if (!module || !submodule || module.slug !== "admin" || submodule.slug !== "user-management" || !user) throw notFound();
    return { module, submodule, user };
  },
  component: UserDetailsPage,
});

function UserDetailsPage() {
  const { module, submodule, user } = Route.useLoaderData();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("General Information");
  const poInitial = user.userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const isTechnicianRole = /tech|technician/i.test(user.type);
  const managerRecord = user.manager ? getUserManagementRecord(user.manager) : undefined;

  const workPlan = useMemo(() => ({
    shift: user.type === "Technician" ? "Field Schedule" : "Office Schedule",
    manager: user.manager || "—",
    office: user.office,
    locations: user.locations,
    technicianId: user.technicianId || "—",
  }), [user]);

  return (
    <>
      <AppHeader />
      <main className="flex-1 bg-slate-950 py-6">
        <div className="max-w-6xl mx-auto px-6">
          <div className="rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{module.label} / {submodule.title}</div>
                <h1 className="mt-1 text-3xl font-bold tracking-tight">{user.userName}</h1>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-300">
                  <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1">{user.loginName}</span>
                  <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1">{user.type}</span>
                  <span className="rounded-full border border-white/10 bg-slate-900/80 px-3 py-1">Office: {user.office}</span>
                </div>
              </div>
              <Link to="/m/$module/$submodule" params={{ module: module.slug, submodule: submodule.slug }} className="btn btn-primary">Back to list</Link>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${activeTab === tab ? "border-blue-400/60 bg-blue-500/25 text-white" : "border-white/20 bg-slate-900/90 text-slate-300 hover:border-slate-200/30 hover:text-white"}`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-white/15 bg-white/8 p-5 text-white backdrop-blur-md">
            {activeTab === "General Information" && (
              <div className="space-y-5">
                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 text-lg font-semibold text-blue-200">General Information</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <InfoCard label="User ID" value={user.id} />
                    <InfoCard label="Status" value="Active" />
                    <InfoCard label="Login ID" value={user.loginName} />
                    <InfoCard label="User Type" value={user.type} />
                    <InfoCard label="User Name" value={user.userName} />
                    <InfoCard label="PO # Initial" value={poInitial || "—"} note="(This value will be used as a part of PO #)" />
                    <InfoCard label="Work Phone #" value="(phone #) / (extension)" />
                    <InfoCard
                      label="Password"
                      value={
                        <div className="space-y-1 text-slate-300 font-normal">
                          <div>minimum of 8 characters.</div>
                          <div>lowercase letters.</div>
                          <div>at least one uppercase letter.</div>
                          <div>at least one number.</div>
                          <div>not include your name, phone #, ID</div>
                        </div>
                      }
                    />
                    <InfoCard
                      label="Direct Manager (In case Tech, this is mandatory)"
                      value={
                        user.manager ? (
                          <Link
                            to="/m/$module/$submodule/$userId"
                            params={{ module: module.slug, submodule: submodule.slug, userId: managerRecord?.loginName ?? user.manager }}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-blue-300 hover:text-blue-200 hover:underline"
                          >
                            {user.manager}
                          </Link>
                        ) : (
                          "—"
                        )
                      }
                    />
                    <InfoCard label="Email" value={user.email || "—"} />
                    <InfoCard label="Office Location*" value={user.office} />
                    <InfoCard label="Location for Email Report" value={user.locations} />
                    <InfoCard label="SMS Available" value="Yes" />
                    <InfoCard label="Chat available" value="Yes" />
                    <InfoCard label="Time Off Schedule" value="Sun Mon Tue Wed Thu Fri Sat" />
                    <InfoCard label="Zebra Printer Name" value="—" />
                    <InfoCard label="MFA - One-Time Password" value="Enabled" />
                  </div>
                </section>

                <section className="rounded-lg border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-4 text-lg font-semibold text-blue-200">Technician Information</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <InfoCard label="Running Call" value={isTechnicianRole ? "Yes" : "No"} />
                    <InfoCard label="Technician ID" value={user.technicianId || "—"} />
                    <InfoCard label="Capacity AM" value={isTechnicianRole ? "4" : "—"} />
                    <InfoCard label="Capacity PM" value={isTechnicianRole ? "4" : "—"} />
                    <InfoCard label="Daily Route Start" value="Office" />
                    <InfoCard label="Daily Route End" value="Office" />
                    <InfoCard label="Office" value={user.office} />
                    <InfoCard label="Commission Rate" value={isTechnicianRole ? "0 %" : "—"} />
                    <InfoCard label="Tech. Payroll Tier" value={isTechnicianRole ? "Tier 1" : "—"} />
                    <InfoCard label="Technician Color" value={isTechnicianRole ? "Blue" : "—"} />
                    <InfoCard label="Product Type Permissions1" value="(blank permission means all permission)" />
                    <InfoCard label="Warranty Type Permissions1" value="(blank permission means all permission)" />
                    <InfoCard label="Repair Type Permissions1" value="(blank permission means all permission)" />
                  </div>
                </section>
              </div>
            )}

            {activeTab === "Work Plan" && (
              <div className="grid gap-4 md:grid-cols-2">
                <InfoCard label="Shift" value={workPlan.shift} />
                <InfoCard label="Manager" value={workPlan.manager} />
                <InfoCard label="Office" value={workPlan.office} />
                <InfoCard label="Locations" value={workPlan.locations} />
                <InfoCard label="Technician ID" value={workPlan.technicianId} />
              </div>
            )}

            {activeTab === "Billing Information" && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <InfoCard label="Billing Status" value="Active" />
                <InfoCard label="Payout Method" value="Direct Deposit" />
                <InfoCard label="Rate Plan" value={user.type.includes("Tech") ? "Field Pay" : "Salary"} />
                <InfoCard label="Tax Profile" value="Configured" />
                <InfoCard label="Next Payout" value="05/30/2026" />
                <InfoCard label="Notes" value="Billing data loaded from the user profile." />
              </div>
            )}

            {activeTab === "Account Information" && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <InfoCard label="Account Status" value="Active" />
                <InfoCard label="Last Login" value="05/29/2026 08:41 AM" />
                <InfoCard label="Role" value={user.type} />
                <InfoCard label="Access Level" value={user.type === "Admin" ? "Full" : user.type === "Manager" ? "Manager" : "Standard"} />
                <InfoCard label="Office Access" value={user.office} />
                <InfoCard label="Location Access" value={user.locations} />
              </div>
            )}

            {activeTab === "Vehicle Information" && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <InfoCard label="Vehicle" value={user.type === "Technician" || user.type.includes("Tech") ? "2019 Ford Transit" : "No assigned vehicle"} />
                <InfoCard label="Plate" value={user.type === "Technician" || user.type.includes("Tech") ? "AHS-2046" : "—"} />
                <InfoCard label="Insurance" value={user.type === "Technician" || user.type.includes("Tech") ? "Valid" : "—"} />
                <InfoCard label="Maintenance" value={user.type === "Technician" || user.type.includes("Tech") ? "Up to date" : "—"} />
              </div>
            )}

            {activeTab === "Employee Information" && (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <InfoCard label="Employee ID" value={user.id} />
                <InfoCard label="Supervisor" value={user.manager || "—"} />
                <InfoCard label="Office" value={user.office} />
                <InfoCard label="Locations" value={user.locations} />
                <InfoCard label="Email" value={user.email || "—"} />
                <InfoCard label="Record Source" value="Admin Hub Solutions user directory" />
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function InfoCard({ label, value, note, secondaryValue }: { label: string; value: ReactNode; note?: string; secondaryValue?: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/90 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white break-words">{value}</div>
      {secondaryValue !== undefined && <div className="mt-2 text-sm text-slate-300 break-words">{secondaryValue}</div>}
      {note && <div className="mt-2 text-xs text-slate-400">{note}</div>}
    </div>
  );
}
