/**
 * Employee Attendance & Visit Exception Report — shared data types only.
 * The real PDF (src/assets/Employee Attendance and Visit Exception
 * Report.pdf) has NO AcroForm fields at all (confirmed by direct
 * inspection), just plain underscore-blank lines and "[ ]" checkbox text —
 * every value is drawn directly onto the page via pdf-lib in
 * visitExceptionReportPdfFill.ts, there's nothing to name.
 *
 * Genuine two-party flow: HR fires this off from the Employee Monitoring →
 * Visit Exception Report tab, pre-filling everything (employee info,
 * exception category checkboxes, and a factual Detailed Reason built from
 * whichever automatic condition(s) triggered — see
 * src/lib/supabase/visitExceptions.ts). The technician only reviews and
 * signs (FillVisitExceptionReportPage.tsx) — the content is presented
 * read-only there, matching the Employee Acknowledgment text on the
 * document itself ("I confirm that the information provided above is
 * accurate and truthful," not "here is my explanation"). The Manager/SBM
 * signature + comments are completed afterward by HR, in person with the
 * manager, via a "Complete Manager Signature" dialog on the same tab —
 * same shape as damageFormTemplate.ts's employer-signature step, since
 * there's no clean way to resolve profiles.manager_name (free text) to a
 * real manager account to route a second login-required signing step to.
 */

export interface VisitExceptionReportFormData {
  /** The employee's actual profile id — not shown on the document itself, just carried alongside for lookups. */
  employeeId: string;
  employeeName: string;
  /** profiles.technician_id, falls back to "" — the closest thing this app has to an "Employee ID" for a technician. */
  employeeIdNumber: string;
  jobTitle: string;
  department: string;
  directManager: string;
  /** "YYYY-MM-DD" — the day the exception(s) happened, not the day this report was sent. */
  dateOfIncident: string;

  reasonMissedWorkday: boolean;
  reasonLateEarly: boolean;
  reasonMissedAppointment: boolean;
  reasonOther: boolean;
  reasonOtherText: string;

  /** Auto-generated from whichever condition(s) triggered (no clock-out /
   *  no on-site check-in or checkout / ticket rescheduled) — see
   *  buildVisitExceptionReasonText in visitExceptions.ts. HR can edit
   *  before sending; read-only to the technician once sent. */
  detailedReason: string;

  /** Only meaningful when the exception is tied to a specific ticket. */
  customerName: string;
  scheduledTime: string;
  actionTaken: string;

  employeeDateSigned: string;
  /** Raw canvas PNG as a data: URL — see w4FormTemplate.ts's header comment for why this is stored alongside the durable Firebase Storage signature URL. */
  employeeSignatureDataUrl: string;

  managerComments: string;
  /** Blank until HR completes the "Complete Manager Signature" step. */
  managerDateSigned: string;
  managerSignatureDataUrl: string;
}

export interface VisitExceptionReportSignature {
  name: string;
  url: string;
  signedAt: string;
}
