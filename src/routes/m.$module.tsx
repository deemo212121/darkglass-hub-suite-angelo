import { createFileRoute, Link, Navigate, notFound } from "@tanstack/react-router";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { ArrowRight, ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/m/$module")({
  head: ({ params }) => ({
    meta: [{ title: `${getModule(params.module)?.label ?? "Module"} — Admin Hub Solutions` }],
  }),
  loader: ({ params }) => {
    const m = getModule(params.module);
    if (!m) throw notFound();
    return { module: m };
  },
  component: ModuleIndex,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="panel text-center max-w-md">
        <h1 className="text-xl font-semibold">Unknown module</h1>
        <Link to="/home" className="btn btn-primary mt-4 inline-flex">Back home</Link>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="panel text-center max-w-md">
        <h1 className="text-xl font-semibold">Couldn't load module</h1>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
    </div>
  ),
});

function ModuleIndex() {
  const { ready, email } = useAuth();
  const { module: m } = Route.useLoaderData();
  if (!ready) return null;
  if (!email) return <Navigate to="/landing" />;
  return (
    <>
      <AppHeader />
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-5">
          <Link to="/home" className="btn"><ChevronLeft className="h-4 w-4" />Home</Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: m.accent }} />
              {m.label}
            </h1>
            <p className="text-sm text-muted-foreground">{m.tagline}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {m.submodules.map((s) => (
            <Link
              key={s.slug}
              to="/m/$module/$submodule"
              params={{ module: m.slug, submodule: s.slug }}
              className="module-card group"
            >
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold">{s.title}</h3>
                <ArrowRight className="ml-auto h-4 w-4 opacity-60 group-hover:translate-x-1 transition" />
              </div>
              <p className="text-sm text-muted-foreground">{s.description}</p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
