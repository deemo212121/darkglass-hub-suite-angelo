import { createFileRoute, Link, Navigate, notFound } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getModule, getSubModule } from "@/lib/modules";
import { GenericModulePage } from "@/components/GenericModulePage";
import { PartReturnStatusPage } from "@/components/PartReturnStatus";

export const Route = createFileRoute("/m/$module/$submodule")({
  head: ({ params }) => ({
    meta: [{
      title: `${getSubModule(params.module, params.submodule)?.title ?? "Sub-module"} — Admin Hub Solutions`,
    }],
  }),
  loader: ({ params }) => {
    const m = getModule(params.module);
    const s = getSubModule(params.module, params.submodule);
    if (!m || !s) throw notFound();
    return { mod: m, sub: s };
  },
  component: SubModule,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="panel text-center max-w-md">
        <h1 className="text-xl font-semibold">Sub-module not found</h1>
        <Link to="/home" className="btn btn-primary mt-4 inline-flex">Back home</Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="panel text-center max-w-md">
        <h1 className="text-xl font-semibold">Couldn't load page</h1>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
    </div>
  ),
});

function SubModule() {
  const { ready, email } = useAuth();
  const { mod, sub } = Route.useLoaderData();
  if (!ready) return null;
  if (!email) return <Navigate to="/landing" />;
  return (
    <>
      <AppHeader />
      {sub.custom === "part-return-status"
        ? <PartReturnStatusPage />
        : <GenericModulePage mod={mod} sub={sub} />}
    </>
  );
}
