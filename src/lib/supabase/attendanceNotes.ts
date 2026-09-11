/**
 * Supabase attendance notes service — the note/notify flow on the Attendance
 * Monitoring "Daily Attendance" tab. One note per (profile, day); see
 * migration 0027 for the profile_id column + unique index.
 */

import { supabase } from "./client";
import { uploadAttendanceNoteAttachmentFile, deleteAttachmentByUrl } from "@/lib/firebase/storage";

export interface AttendanceNoteRow {
  profileId: string;
  noteDate: string;
  content: string;
  /** HR's own note on this (profile, day) — separate from `content` (the
   *  general/manager-facing note) so saving one never overwrites the
   *  other. See migration 0220. */
  hrNote: string;
  notifyIndividual: boolean;
  notifyTeamLead: boolean;
  createdBy: string | null;
  /** Firebase Storage download URL for a file backing up an HR Status (e.g.
   *  a doctor's note) — see uploadAttendanceNoteAttachment. See migration 0244. */
  attachmentPath: string | null;
  /** Who attached the current (or most recently removed) file, and when. See migration 0246. */
  attachmentAddedBy: string | null;
  attachmentAddedAt: string | null;
  /** Set when a previously-attached file was removed; kept even after
   *  attachmentPath goes back to null so "Removed by X" can still show. */
  attachmentRemovedBy: string | null;
  attachmentRemovedAt: string | null;
}

// Supabase caps an unbounded select at 1000 rows — a company's attendance
// notes within a date range can exceed that. Page through in chunks of 1000.
const PAGE_SIZE = 1000;

const SELECT_COLUMNS =
  "profile_id, note_date, content, hr_note, notify_individual, notify_team_lead, created_by, attachment_path, attachment_added_by, attachment_added_at, attachment_removed_by, attachment_removed_at";
// Falls back to this if attachment_added_by/etc. don't exist yet — i.e.
// 0246_attachment_added_removed_by.sql hasn't been run against this database.
const SELECT_COLUMNS_NO_ATTACHMENT_META = "profile_id, note_date, content, hr_note, notify_individual, notify_team_lead, created_by, attachment_path";
// Falls back further to this if attachment_path doesn't exist either — i.e.
// 0244_attendance_notes_attachment.sql hasn't been run against this database.
const SELECT_COLUMNS_NO_ATTACHMENT = "profile_id, note_date, content, hr_note, notify_individual, notify_team_lead, created_by";

/** Postgres 42703 = "column ... does not exist" — a newer migration hasn't been applied yet. */
function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

/** All attendance notes in a date range for the caller's company (RLS-scoped). */
export async function getAttendanceNotes(
  startDate: string,
  endDate: string
): Promise<AttendanceNoteRow[]> {
  const all: AttendanceNoteRow[] = [];
  let columns = SELECT_COLUMNS;
  for (let from = 0; ; from += PAGE_SIZE) {
    const runQuery = (cols: string) =>
      supabase
        .from("attendance_notes")
        .select(cols)
        .not("profile_id", "is", null)
        .gte("note_date", startDate)
        .lte("note_date", endDate)
        .range(from, from + PAGE_SIZE - 1);
    let { data, error } = await runQuery(columns);
    if (isMissingColumnError(error) && columns === SELECT_COLUMNS) {
      columns = SELECT_COLUMNS_NO_ATTACHMENT_META;
      ({ data, error } = await runQuery(columns));
    }
    if (isMissingColumnError(error) && columns === SELECT_COLUMNS_NO_ATTACHMENT_META) {
      columns = SELECT_COLUMNS_NO_ATTACHMENT;
      ({ data, error } = await runQuery(columns));
    }
    if (error) {
      console.error("getAttendanceNotes error:", error.message);
      return [];
    }
    all.push(
      ...(data ?? []).map((row: any) => ({
        profileId: row.profile_id,
        noteDate: row.note_date,
        content: row.content ?? "",
        hrNote: row.hr_note ?? "",
        notifyIndividual: Boolean(row.notify_individual),
        notifyTeamLead: Boolean(row.notify_team_lead),
        createdBy: row.created_by ?? null,
        attachmentPath: row.attachment_path ?? null,
        attachmentAddedBy: row.attachment_added_by ?? null,
        attachmentAddedAt: row.attachment_added_at ?? null,
        attachmentRemovedBy: row.attachment_removed_by ?? null,
        attachmentRemovedAt: row.attachment_removed_at ?? null,
      }))
    );
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Create or replace the note for a given profile + day. `companyId` is kept
 * on the input shape for call-site compatibility but is NOT sent in the
 * write payload — attendance_notes.company_id is a `uuid` column and the
 * value the rest of the app calls "companyId" (useAuth().companyId) is
 * actually companies.legacy_code, a text code (e.g. "COMP001"), not that
 * uuid (see getProfileForLogin in supabase/users.ts). Sending it here fails
 * with "invalid input syntax for type uuid" before the row is even built.
 * A `before insert` trigger (set_company_id(), see 0001_init.sql) already
 * stamps the real uuid via a live auth_company_id() lookup on every insert,
 * so the column is correctly populated without any client-supplied value.
 */
export async function upsertAttendanceNote(input: {
  profileId: string;
  noteDate: string;
  content: string;
  notifyIndividual: boolean;
  notifyTeamLead: boolean;
  createdBy: string | null;
  companyId?: string;
}): Promise<void> {
  const { error } = await supabase.from("attendance_notes").upsert(
    {
      profile_id: input.profileId,
      note_date: input.noteDate,
      content: input.content,
      notify_individual: input.notifyIndividual,
      notify_team_lead: input.notifyTeamLead,
      created_by: input.createdBy,
    },
    { onConflict: "profile_id,note_date" }
  );
  if (error) {
    console.error("upsertAttendanceNote error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Create or replace ONLY the HR note for a given profile + day — a
 * separate slot from `content` (upsertAttendanceNote above), so an HR
 * user saving their own note can never clobber whatever the general/
 * manager note already says, and vice versa. Deliberately omits `content`
 * from the upsert payload entirely (rather than sending it unchanged) so
 * this stays a true partial update on conflict; migration 0220 relaxed
 * `content`'s NOT NULL constraint specifically so a brand-new (profile,
 * day) row can still be created by an HR-only save with no manager note
 * yet on file. `companyId` is accepted for call-site compatibility but
 * never sent — see upsertAttendanceNote's comment above for why.
 */
export async function upsertAttendanceHrNote(profileId: string, noteDate: string, hrNote: string, createdBy?: string | null, companyId?: string | null): Promise<void> {
  const payload: Record<string, unknown> = { profile_id: profileId, note_date: noteDate, hr_note: hrNote };
  // Only stamped when given — a missing/unresolved caller id must never
  // null out whoever set this previously, on either the first save or a
  // later edit.
  if (createdBy) payload.created_by = createdBy;
  const { error } = await supabase.from("attendance_notes").upsert(payload, { onConflict: "profile_id,note_date" });
  if (error) {
    console.error("upsertAttendanceHrNote error:", error.message);
    throw new Error(error.message);
  }
}

/**
 * Uploads a photo/file backing up an HR Status (e.g. a doctor's note) and
 * records its download URL on the (profile, day) row — Firebase Storage
 * (same as every other ad hoc file upload in this app; see
 * firebase/storage.ts's uploadAttendanceNoteAttachmentFile), not Supabase
 * Storage. Upserts rather than a plain update so this still works even if
 * HR attaches a file before ever touching the HR Status dropdown for that
 * day. Returns the URL directly — no separate "resolve a signed URL" step
 * is needed to view it later. `companyId` here is only a Firebase Storage
 * path segment (namespacing, not typed) — NOT sent to Supabase; see
 * upsertAttendanceNote's comment for why passing it there breaks the write.
 * `addedBy` (the uploader's profile id) is stamped as attachment_added_by,
 * and any prior removal record is cleared since this attachment supersedes it.
 */
export async function uploadAttendanceNoteAttachment(profileId: string, noteDate: string, companyId: string, file: File, addedBy?: string | null): Promise<string> {
  const url = await uploadAttendanceNoteAttachmentFile(companyId, profileId, noteDate, file);

  const { error } = await supabase.from("attendance_notes").upsert(
    {
      profile_id: profileId,
      note_date: noteDate,
      attachment_path: url,
      attachment_added_by: addedBy ?? null,
      attachment_added_at: new Date().toISOString(),
      attachment_removed_by: null,
      attachment_removed_at: null,
    },
    { onConflict: "profile_id,note_date" }
  );
  if (error) throw new Error(error.message);
  return url;
}

/**
 * Removes an HR Status attachment — deletes the Firebase Storage file and
 * clears attachment_path on the (profile, day) row. `removedBy` (the
 * remover's profile id) is stamped as attachment_removed_by so "Removed by
 * X" can still show even with no file left to view; attachment_added_by/at
 * are left untouched as a record of who originally attached it.
 */
export async function removeAttendanceNoteAttachment(profileId: string, noteDate: string, attachmentUrl: string, removedBy?: string | null): Promise<void> {
  await deleteAttachmentByUrl(attachmentUrl).catch((err) => {
    // Same fail-open reasoning as removePtoAttachment in pto.ts — don't let
    // a Storage-side hiccup block clearing the DB reference.
    console.warn("removeAttendanceNoteAttachment: Storage delete failed, clearing DB reference anyway:", err);
  });
  const { error } = await supabase.from("attendance_notes").upsert(
    {
      profile_id: profileId,
      note_date: noteDate,
      attachment_path: null,
      attachment_removed_by: removedBy ?? null,
      attachment_removed_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,note_date" }
  );
  if (error) throw new Error(error.message);
}
