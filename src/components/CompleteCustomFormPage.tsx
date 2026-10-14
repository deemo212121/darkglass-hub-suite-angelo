/**
 * Direct signing link for a custom form's company part — /complete-form/$submissionId.
 * HR copies it from Custom Forms → Submissions ("Copy signing link") once the
 * person has submitted, and sends it to whoever signs for the company (e.g.
 * the CEO), so they sign without going through HR Paperworks.
 *
 * Requires login. Shows the whole document as a paper page (the form's text
 * and the submitter's signed answers read-only) with only the signer's own
 * part open — a part locked to someone else (config.signer, see
 * customFormSections.ts) shows "Waiting for … to sign." Saving goes through
 * the same saveCompanyPart as the Complete dialog in CustomFormsPanel.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { FillFormSignInRequired } from "@/components/FillFormSignInRequired";
import { getMyProfileId } from "@/lib/supabase/users";
import { getCustomForm, getCustomFormSubmission, type CustomForm, type CustomFormSubmission } from "@/lib/supabase/customForms";
import { saveCompanyPart } from "@/lib/customFormCompletion";
import type { CurrentSigner } from "@/lib/customFormSections";
import { CustomFormRenderer, type CustomFormRendererValue } from "@/components/CustomFormRenderer";
import { InlinePdfLink } from "@/components/InlinePdfViewer";
import usihsLogo from "@/assets/us-in-home-services-logo.png";

export function CompleteCustomFormPage({ submissionId }: { submissionId: string }) {
  const { ready, uid, realRole, extraRoles, viewAsRole } = useAuth();
  const [form, setForm] = useState<CustomForm | null>(null);
  const [submission, setSubmission] = useState<CustomFormSubmission | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ waitingOn: string[]; documentError: boolean } | null>(null);

  useEffect(() => {
    if (!ready || !uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sub, profileId] = await Promise.all([getCustomFormSubmission(submissionId), getMyProfileId(uid)]);
        if (cancelled) return;
        setMyProfileId(profileId);
        const doc = sub ? await getCustomForm(sub.formId) : null;
        if (cancelled) return;
        if (!sub || !doc) setError("This signing link isn't valid, or the document was removed.");
        else { setSubmission(sub); setForm(doc); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, uid, submissionId]);

  // The real role — a "View as" preview doesn't let anyone sign as another role.
  const me = useMemo<CurrentSigner>(
    () => ({ profileId: myProfileId, roles: [realRole, ...(viewAsRole ? [] : extraRoles)].filter((r): r is string => !!r) }),
    [myProfileId, realRole, extraRoles, viewAsRole]
  );

  const handleSubmit = async (values: Record<string, CustomFormRendererValue>) => {
    if (!form || !submission) return;
    if (!myProfileId) throw new Error("Couldn't identify your account — refresh and try again.");
    const result = await saveCompanyPart(form, submission, values, myProfileId);
    setSubmission(result.submission);
    setDone({ waitingOn: result.waitingOn, documentError: result.documentError });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="max-w-4xl mx-auto p-4">
        <Link to="/home" className="btn text-xs px-2.5 py-1.5 flex items-center gap-1 w-fit mb-4">
          <ChevronLeft className="h-3.5 w-3.5" /> Home
        </Link>

        {ready && !uid ? (
          <FillFormSignInRequired />
        ) : loading ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : error || !form || !submission ? (
          <div className="panel p-6 text-sm text-red-300">{error ?? "This signing link isn't valid."}</div>
        ) : done || submission.completedAt ? (
          <div className="panel p-6 text-center">
            <p className="text-sm font-semibold mb-1">
              {done ? "✅ Signed — thank you." : "This document is already fully signed."}
            </p>
            {done && done.waitingOn.length > 0 && <p className="text-xs text-muted-foreground">Still waiting on: {done.waitingOn.join(", ")}.</p>}
            {done && !done.waitingOn.length && <p className="text-xs text-muted-foreground">Everyone has signed — the finished document is saved.</p>}
            {done?.documentError && <p className="text-xs text-amber-400 mt-1">The document couldn't be saved just now — HR can open it from Custom Forms to save it.</p>}
            {submission.pdfUrl && (
              <div className="mt-3">
                <InlinePdfLink url={submission.pdfUrl} label="View the signed document" className="text-blue-300 hover:text-blue-200 underline text-sm" />
              </div>
            )}
          </div>
        ) : (
          <div className="panel p-4 sm:p-5">
            <h1 className="text-lg font-bold mb-1">{submission.formTitle || form.title}</h1>
            <p className="text-sm text-muted-foreground mb-4">
              Submitted by {submission.submitterName || "Someone"} on {new Date(submission.submittedAt).toLocaleDateString()}. Read the document, then sign your part at the bottom.
            </p>
            <CustomFormRenderer
              key={submission.id}
              fields={form.fields}
              mode="company"
              showSubmitterPart
              signer={me}
              initialValues={submission.responses}
              onSubmit={(values) => handleSubmit(values)}
              paper={{ header: <img src={usihsLogo} alt="US In Home Services" className="h-[100px] w-[100px] mx-auto mb-5" /> }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
