/**
 * "Basic" category — see src/lib/formElements/index.ts for the full
 * category list/order. Heading reuses makeDisplayElement. Full Name,
 * Address, Appointment, Signature, Fill in the Blank, and Product List are
 * bespoke composite fields (their value is an object/array, not a single
 * string) — Email/Phone/Date Picker are bespoke too now that they carry
 * real type-specific settings beyond a plain text input.
 */
import { useEffect, useRef, useState } from "react";
import { Heading as HeadingIcon, User, Mail, MapPin, Phone as PhoneIcon, Calendar, CalendarClock, PenTool, Pilcrow, ShoppingCart, Trash2, Plus } from "lucide-react";
import type { ElementDefinition } from "./types";
import { makeDisplayElement } from "./factories";
import { COUNTRY_CALLING_CODES } from "@/lib/countryCallingCodes";

export const headingElement = makeDisplayElement({ type: "heading", label: "Heading", icon: HeadingIcon, category: "basic", variant: "heading", defaultText: "Heading" });

export const emailElement: ElementDefinition = {
  type: "email",
  label: "Email",
  icon: Mail,
  category: "basic",
  kind: "field",
  defaultConfig: () => ({ allowedDomains: "", blockedDomains: "", autocomplete: true }),
  CanvasPreview: ({ field }) => <input type="email" disabled placeholder={field.placeholder || "name@example.com"} className="w-full max-w-sm text-sm border-0 border-b border-slate-300 bg-transparent py-1 text-slate-400" />,
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Allowed Domains (comma-separated)</label><input type="text" value={field.config.allowedDomains ?? ""} onChange={(e) => set({ allowedDomains: e.target.value })} placeholder="company.com, partner.com" className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Blocked Domains (comma-separated)</label><input type="text" value={field.config.blockedDomains ?? ""} onChange={(e) => set({ blockedDomains: e.target.value })} placeholder="tempmail.com" className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={field.config.autocomplete !== false} onChange={(e) => set({ autocomplete: e.target.checked })} /> Enable Browser Autocomplete</label>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => (
    <input type="email" value={value ?? ""} readOnly={field.readonly} autoComplete={field.config.autocomplete === false ? "off" : "email"} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="glass-input text-sm py-2 px-3 rounded-md w-full" />
  ),
  isEmptyValue: (value) => !value || !String(value).trim(),
  validateValue: (value, field) => (value ? checkEmailDomain(String(value), field.config.allowedDomains, field.config.blockedDomains) : null),
};

/** Domain allow/block-list check for the Email element — exported so CustomFormRenderer's validator can call it. */
export function checkEmailDomain(email: string, allowedDomains?: string, blockedDomains?: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return null;
  const blocked = (blockedDomains ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (blocked.includes(domain)) return "This email domain isn't allowed.";
  const allowed = (allowedDomains ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(domain)) return `Email must be one of: ${allowed.join(", ")}`;
  return null;
}

export const addressElement: ElementDefinition = {
  type: "address",
  label: "Address",
  icon: MapPin,
  category: "basic",
  kind: "field",
  defaultConfig: () => ({ defaultCountry: "United States" }),
  CanvasPreview: () => (
    <div className="flex flex-col gap-1.5 max-w-md">
      {["Street Address", "Street Address Line 2", "City, State, ZIP", "Country"].map((p) => (
        <div key={p}>
          <p className="text-[10px] text-slate-400 mb-0.5">{p}</p>
          <div className="border-b border-slate-300 h-5" />
        </div>
      ))}
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Default Country</label>
      <input type="text" value={field.config.defaultCountry ?? ""} onChange={(e) => onChange({ ...field, config: { ...field.config, defaultCountry: e.target.value } })} className="glass-input text-sm py-1.5 px-2.5 rounded-md" />
    </div>
  ),
  FillInput: ({ field, value, onChange }) => {
    const v = value ?? { country: field.config.defaultCountry };
    const set = (k: string, val: string) => onChange({ ...v, [k]: val });
    return (
      <div className="flex flex-col gap-2 max-w-md">
        <input type="text" placeholder="Street address" value={v.street ?? ""} onChange={(e) => set("street", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md" />
        <input type="text" placeholder="Street address line 2" value={v.street2 ?? ""} onChange={(e) => set("street2", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md" />
        <div className="flex gap-2">
          <input type="text" placeholder="City" value={v.city ?? ""} onChange={(e) => set("city", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md flex-1" />
          <input type="text" placeholder="State / Province" value={v.state ?? ""} onChange={(e) => set("state", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md w-28" />
          <input type="text" placeholder="ZIP" value={v.zip ?? ""} onChange={(e) => set("zip", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md w-24" />
        </div>
        <input type="text" placeholder="Country" value={v.country ?? ""} onChange={(e) => set("country", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md" />
      </div>
    );
  },
  isEmptyValue: (value) => !value?.street?.trim() || !value?.city?.trim() || !value?.state?.trim() || !value?.zip?.trim(),
  formatValue: (value) => {
    if (!value) return "";
    const cityStateZip = [value.city, [value.state, value.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [value.street, value.street2, cityStateZip, value.country].filter((p) => p && String(p).trim()).join(", ");
  },
};

export const phoneElement: ElementDefinition = {
  type: "phone",
  label: "Phone",
  icon: PhoneIcon,
  category: "basic",
  kind: "field",
  defaultConfig: () => ({ countryCode: "+1", mask: "(###) ###-####" }),
  CanvasPreview: ({ field, config }) => (
    <div className="flex items-center gap-1.5 text-sm text-slate-400">
      <span className="border border-slate-300 rounded-md px-2 py-1">{config.countryCode || "+1"}</span>
      <input type="tel" disabled placeholder={field.placeholder || config.mask || "Phone number"} className="flex-1 max-w-xs border-0 border-b border-slate-300 bg-transparent py-1" />
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Default Country Code</label>
          <select value={field.config.countryCode ?? "+1"} onChange={(e) => set({ countryCode: e.target.value })} className="glass-input text-sm py-1.5 px-2.5 rounded-md">
            {COUNTRY_CALLING_CODES.map((c) => (
              <option key={c.name} value={c.code}>{c.name} ({c.code})</option>
            ))}
          </select>
          <p className="text-[10px] text-muted-foreground">Whoever fills this out can still pick a different country themselves — this just sets what's selected by default.</p>
        </div>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Mask (# = digit)</label><input type="text" value={field.config.mask ?? ""} onChange={(e) => set({ mask: e.target.value })} placeholder="(###) ###-####" className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    // Legacy submissions stored value as a plain string (no country picker
    // yet) — treat that as the number with the field's default country.
    const asObject = value && typeof value === "object" ? value : null;
    const countryCode: string = asObject?.countryCode ?? field.config.countryCode ?? "+1";
    const number: string = asObject?.number ?? (typeof value === "string" ? value : "");

    const applyMask = (raw: string): string => {
      const mask: string = field.config.mask || "";
      if (!mask) return raw;
      const digits = raw.replace(/\D/g, "");
      let out = "";
      let di = 0;
      for (const ch of mask) {
        if (di >= digits.length) break;
        if (ch === "#") { out += digits[di]; di += 1; } else { out += ch; }
      }
      return out;
    };
    return (
      <div className="flex items-center gap-1.5">
        <select
          value={countryCode}
          disabled={field.readonly}
          onChange={(e) => onChange({ countryCode: e.target.value, number })}
          className="glass-input text-sm py-2 px-2 rounded-md w-36 shrink-0"
        >
          {COUNTRY_CALLING_CODES.map((c) => (
            <option key={c.name} value={c.code}>{c.name} ({c.code})</option>
          ))}
        </select>
        <input
          type="tel"
          value={number}
          readOnly={field.readonly}
          onChange={(e) => onChange({ countryCode, number: applyMask(e.target.value) })}
          placeholder={field.placeholder || field.config.mask}
          className="glass-input text-sm py-2 px-3 rounded-md flex-1"
        />
      </div>
    );
  },
  isEmptyValue: (value) => {
    if (!value) return true;
    if (typeof value === "string") return !value.trim();
    return !value.number || !String(value.number).trim();
  },
  formatValue: (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    return [value.countryCode, value.number].filter(Boolean).join(" ");
  },
};

const isWeekend = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return d.getDay() === 0 || d.getDay() === 6; };

export const datePickerElement: ElementDefinition = {
  type: "datePicker",
  label: "Date Picker",
  icon: Calendar,
  category: "basic",
  kind: "field",
  defaultConfig: () => ({ minDate: "", maxDate: "", disableWeekends: false, dateFormat: "MM/DD/YYYY", timeZone: "" }),
  CanvasPreview: ({ field }) => <input type="date" disabled placeholder={field.placeholder} className="w-fit text-sm border border-slate-300 rounded-md px-3 py-1.5 text-slate-400" />,
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Min Date</label><input type="date" value={field.config.minDate ?? ""} onChange={(e) => set({ minDate: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max Date</label><input type="date" value={field.config.maxDate ?? ""} onChange={(e) => set({ maxDate: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!field.config.disableWeekends} onChange={(e) => set({ disableWeekends: e.target.checked })} /> Disable Weekends</label>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date Format (display only)</label>
          <select value={field.config.dateFormat ?? "MM/DD/YYYY"} onChange={(e) => set({ dateFormat: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md">
            <option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Time Zone (label only)</label><input type="text" value={field.config.timeZone ?? ""} onChange={(e) => set({ timeZone: e.target.value })} placeholder="e.g. America/New_York" className="glass-input text-sm py-1.5 px-2.5 rounded-md" /></div>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => (
    <input
      type="date"
      value={value ?? ""}
      readOnly={field.readonly}
      min={field.config.minDate || undefined}
      max={field.config.maxDate || undefined}
      onChange={(e) => {
        if (field.config.disableWeekends && e.target.value && isWeekend(e.target.value)) return;
        onChange(e.target.value);
      }}
      className="glass-input text-sm py-2 px-3 rounded-md w-fit"
    />
  ),
  isEmptyValue: (value) => !value,
};

const APPOINTMENT_DURATIONS = [15, 30, 45, 60];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const appointmentElement: ElementDefinition = {
  type: "appointment",
  label: "Appointment",
  icon: CalendarClock,
  category: "basic",
  kind: "field",
  defaultConfig: () => ({ workingDays: [1, 2, 3, 4, 5], workingHoursStart: "09:00", workingHoursEnd: "17:00", bufferMinutes: 0, meetingDuration: 30, maxAppointments: undefined }),
  CanvasPreview: () => (
    <div className="flex gap-2">
      <div className="border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-400 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> mm/dd/yyyy</div>
      <div className="border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-400">--:-- --</div>
      <div className="border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-400">30 min</div>
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    const workingDays: number[] = field.config.workingDays ?? [1, 2, 3, 4, 5];
    const toggleDay = (d: number) => set({ workingDays: workingDays.includes(d) ? workingDays.filter((x) => x !== d) : [...workingDays, d].sort() });
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Working Days</label>
          <div className="flex gap-1">
            {WEEKDAY_LABELS.map((d, i) => (
              <button key={i} type="button" onClick={() => toggleDay(i)} className={`h-7 w-9 rounded text-[10px] border ${workingDays.includes(i) ? "bg-primary/20 border-primary/40 text-foreground" : "border-white/10 text-muted-foreground"}`}>{d}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Start</label><input type="time" value={field.config.workingHoursStart ?? "09:00"} onChange={(e) => set({ workingHoursStart: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">End</label><input type="time" value={field.config.workingHoursEnd ?? "17:00"} onChange={(e) => set({ workingHoursEnd: e.target.value })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Meeting Duration</label>
            <select value={field.config.meetingDuration ?? 30} onChange={(e) => set({ meetingDuration: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md">
              {APPOINTMENT_DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Buffer Time (min)</label><input type="number" min={0} value={field.config.bufferMinutes ?? 0} onChange={(e) => set({ bufferMinutes: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Max Appointments/Day</label><input type="number" min={0} value={field.config.maxAppointments ?? ""} onChange={(e) => set({ maxAppointments: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
        </div>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    const v = value ?? {};
    const set = (k: string, val: string) => onChange({ ...v, [k]: val });
    const workingDays: number[] = field.config.workingDays ?? [1, 2, 3, 4, 5];
    return (
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          value={v.date ?? ""}
          onChange={(e) => { if (e.target.value && !workingDays.includes(new Date(`${e.target.value}T00:00:00`).getDay())) return; set("date", e.target.value); }}
          className="glass-input text-sm py-2 px-3 rounded-md"
        />
        <input type="time" value={v.time ?? ""} min={field.config.workingHoursStart} max={field.config.workingHoursEnd} onChange={(e) => set("time", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md" />
        <select value={v.duration ?? field.config.meetingDuration ?? ""} onChange={(e) => set("duration", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md">
          <option value="">Duration…</option>
          {APPOINTMENT_DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
        </select>
      </div>
    );
  },
  isEmptyValue: (value) => !value?.date || !value?.time,
};

export const signatureElement: ElementDefinition = {
  type: "signature",
  label: "Signature",
  icon: PenTool,
  category: "basic",
  kind: "field",
  isFileField: true,
  defaultConfig: () => ({ canvasWidth: 360, canvasHeight: 120, penColor: "#0f172a", backgroundColor: "#ffffff", allowClear: true }),
  CanvasPreview: ({ config }) => (
    <div style={{ width: Math.min(config.canvasWidth ?? 360, 400), height: config.canvasHeight ?? 120, backgroundColor: config.backgroundColor || "#ffffff" }} className="max-w-sm border border-dashed border-slate-300 rounded-md flex items-center justify-center text-sm text-slate-400 italic">
      Sign here
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const set = (patch: Record<string, any>) => onChange({ ...field, config: { ...field.config, ...patch } });
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Canvas Width</label><input type="number" value={field.config.canvasWidth ?? 360} onChange={(e) => set({ canvasWidth: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Canvas Height</label><input type="number" value={field.config.canvasHeight ?? 120} onChange={(e) => set({ canvasHeight: Number(e.target.value) })} className="glass-input text-sm py-1.5 px-2 rounded-md" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Pen Color</label><input type="color" value={field.config.penColor ?? "#0f172a"} onChange={(e) => set({ penColor: e.target.value })} className="h-8 w-16" /></div>
          <div className="flex flex-col gap-1"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Background</label><input type="color" value={field.config.backgroundColor ?? "#ffffff"} onChange={(e) => set({ backgroundColor: e.target.value })} className="h-8 w-16" /></div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={field.config.allowClear !== false} onChange={(e) => set({ allowClear: e.target.checked })} /> Allow Clear</label>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingRef = useRef(false);
    const hasDrawnRef = useRef(false);
    const width = field.config.canvasWidth ?? 360;
    const height = field.config.canvasHeight ?? 120;
    const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const c = canvasRef.current!;
      const r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
    };
    const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
      drawingRef.current = true;
      const ctx = canvasRef.current!.getContext("2d")!;
      const { x, y } = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const ctx = canvasRef.current!.getContext("2d")!;
      const { x, y } = pos(e);
      ctx.lineTo(x, y);
      ctx.strokeStyle = field.config.penColor || "#0f172a";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.stroke();
      hasDrawnRef.current = true;
    };
    const end = () => {
      drawingRef.current = false;
      if (!hasDrawnRef.current || !canvasRef.current) return;
      canvasRef.current.toBlob((blob) => {
        if (blob) onChange(new File([blob], `${field.id}-signature.png`, { type: "image/png" }));
      }, "image/png");
    };
    const clear = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      hasDrawnRef.current = false;
      onChange(null);
    };
    return (
      <div className="flex flex-col gap-1.5 items-start">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{ backgroundColor: field.config.backgroundColor || "#ffffff" }}
          className="touch-none cursor-crosshair rounded-md border border-white/20"
        />
        {field.config.allowClear !== false && <button type="button" onClick={clear} className="btn text-xs px-2.5 py-1">Clear</button>}
        {value instanceof File && <span className="text-xs text-muted-foreground">Signed</span>}
      </div>
    );
  },
  isEmptyValue: (value) => !(value instanceof File),
};

/** Splits a "___"-blank template into alternating text/blank segments, e.g. "I ___ to ___" → ["I ", BLANK, " to ", BLANK]. Exported so DocumentTemplateEditor.tsx can preview a referenced Fill in the Blank field's own template (with visible blanks) instead of just the raw {{fieldName}} token. */
export function parseBlankTemplate(template: string): (string | null)[] {
  return template.split(/(_{2,}|\{\{[^}]+\}\})/).map((part) => (/^_{2,}$/.test(part) || /^\{\{[^}]+\}\}$/.test(part) ? null : part)).filter((p) => p !== "");
}

export const fillInTheBlankElement: ElementDefinition = {
  type: "fillInTheBlank",
  label: "Fill in the Blank",
  icon: Pilcrow,
  category: "basic",
  kind: "field",
  defaultConfig: () => ({ template: "I ___ to receive updates by ___." }),
  CanvasPreview: ({ config }) => (
    <p className="text-sm text-slate-600 leading-7">
      {parseBlankTemplate(config.template ?? "").map((seg, i) => (seg === null ? <span key={i} className="inline-block w-24 border-b border-slate-400 mx-1" /> : <span key={i}>{seg}</span>))}
    </p>
  ),
  PropertiesPanel: ({ field, onChange, allFields }) => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    // Auto-grows with content instead of scrolling inside a fixed-height box — a multi-sentence template needs to stay fully visible while typing.
    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, [field.config.template]);
    const insertVariable = (name: string) => {
      const token = `{{${name}}}`;
      const el = textareaRef.current;
      const current = field.config.template ?? "";
      if (el && document.activeElement === el) {
        const start = el.selectionStart ?? current.length;
        const end = el.selectionEnd ?? current.length;
        const next = current.slice(0, start) + token + current.slice(end);
        onChange({ ...field, config: { ...field.config, template: next } });
      } else {
        onChange({ ...field, config: { ...field.config, template: `${current}${token}` } });
      }
    };
    const otherFields = allFields.filter((f) => f.id !== field.id && f.name);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Template (use ___ for a blank, or click a variable below)</label>
          <textarea
            ref={textareaRef}
            value={field.config.template ?? ""}
            onChange={(e) => onChange({ ...field, config: { ...field.config, template: e.target.value } })}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const name = e.dataTransfer.getData("text/plain"); if (name) insertVariable(name); }}
            className="glass-input text-sm py-1.5 px-2.5 rounded-md min-h-24 resize-none overflow-hidden"
          />
        </div>
        {otherFields.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Variables — click or drag into the template</label>
            <div className="flex flex-wrap gap-1.5">
              {otherFields.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", f.name)}
                  onClick={() => insertVariable(f.name)}
                  className="text-[10px] px-2 py-1 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25 cursor-grab"
                >
                  {`{{${f.name}}}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    const segments = parseBlankTemplate(field.config.template ?? "");
    const answers: string[] = Array.isArray(value) ? value : [];
    let blankIndex = -1;
    return (
      <p className="text-sm leading-8 flex flex-wrap items-center gap-1">
        {segments.map((seg, i) => {
          if (seg !== null) return <span key={i}>{seg}</span>;
          blankIndex += 1;
          const idx = blankIndex;
          return (
            <input
              key={i}
              type="text"
              value={answers[idx] ?? ""}
              onChange={(e) => { const next = [...answers]; next[idx] = e.target.value; onChange(next); }}
              className="glass-input text-sm py-1 px-2 rounded-md w-28 inline-block"
            />
          );
        })}
      </p>
    );
  },
  isEmptyValue: (value) => !Array.isArray(value) || value.some((v) => !v?.trim()),
  /** Reconstructs the actual filled-in sentence (blanks replaced by their answers) rather than the generic "join the raw answers array with commas" fallback — otherwise the submissions table and any Document Template referencing this field just dump "answer1, answer2, ..." instead of the sentence itself. */
  formatValue: (value, field) => {
    const segments = parseBlankTemplate(field.config.template ?? "");
    const answers: string[] = Array.isArray(value) ? value : [];
    let blankIndex = -1;
    return segments
      .map((seg) => {
        if (seg !== null) return seg;
        blankIndex += 1;
        return answers[blankIndex]?.trim() || "____";
      })
      .join("");
  },
};

interface Product { id: string; name: string; price: number; image?: string; discountPct?: number; taxPct?: number }

export const productListElement: ElementDefinition = {
  type: "productList",
  label: "Product List",
  icon: ShoppingCart,
  category: "basic",
  kind: "field",
  defaultConfig: (): { products: Product[]; currency: string } => ({ products: [{ id: "p1", name: "Item 1", price: 0 }], currency: "$" }),
  CanvasPreview: ({ config }) => (
    <div className="flex flex-col gap-1 max-w-sm">
      {(config.products ?? []).map((p: Product) => (
        <div key={p.id} className="flex items-center justify-between text-sm text-slate-600 border-b border-slate-100 py-1">
          <span className="flex items-center gap-2">{p.image && <img src={p.image} alt="" className="h-6 w-6 rounded object-cover" />}{p.name}</span>
          <span className="flex items-center gap-2 text-slate-400"><span>{config.currency || "$"}{p.price.toFixed(2)}</span><span className="border border-slate-300 rounded px-1.5">Qty</span></span>
        </div>
      ))}
    </div>
  ),
  PropertiesPanel: ({ field, onChange }) => {
    const products: Product[] = field.config.products ?? [];
    const setProducts = (next: Product[]) => onChange({ ...field, config: { ...field.config, products: next } });
    const patchProduct = (i: number, patch: Partial<Product>) => setProducts(products.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5"><label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Currency Symbol</label><input type="text" value={field.config.currency ?? "$"} onChange={(e) => onChange({ ...field, config: { ...field.config, currency: e.target.value } })} className="glass-input text-sm py-1.5 px-2 rounded-md w-16" /></div>
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Products</label>
        {products.map((p, i) => (
          <div key={p.id} className="flex flex-col gap-1.5 border border-white/10 rounded-md p-2">
            <div className="flex items-center gap-1.5">
              <input type="text" value={p.name} onChange={(e) => patchProduct(i, { name: e.target.value })} className="glass-input text-xs py-1.5 px-2 rounded-md flex-1" placeholder="Name" />
              <button type="button" onClick={() => setProducts(products.filter((_, idx) => idx !== i))} disabled={products.length <= 1} className="text-muted-foreground hover:text-red-400 disabled:opacity-30 shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input type="number" value={p.price} onChange={(e) => patchProduct(i, { price: Number(e.target.value) })} className="glass-input text-xs py-1.5 px-2 rounded-md" placeholder="Price" />
              <input type="text" value={p.image ?? ""} onChange={(e) => patchProduct(i, { image: e.target.value })} className="glass-input text-xs py-1.5 px-2 rounded-md" placeholder="Image URL" />
              <input type="number" value={p.discountPct ?? ""} onChange={(e) => patchProduct(i, { discountPct: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-xs py-1.5 px-2 rounded-md" placeholder="Discount %" />
              <input type="number" value={p.taxPct ?? ""} onChange={(e) => patchProduct(i, { taxPct: e.target.value ? Number(e.target.value) : undefined })} className="glass-input text-xs py-1.5 px-2 rounded-md" placeholder="Tax %" />
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setProducts([...products, { id: `p${products.length + 1}_${Date.now()}`, name: `Item ${products.length + 1}`, price: 0 }])} className="text-xs text-blue-400 hover:text-blue-300 self-start flex items-center gap-1">
          <Plus className="h-3 w-3" /> Add product
        </button>
      </div>
    );
  },
  FillInput: ({ field, value, onChange }) => {
    const products: Product[] = field.config.products ?? [];
    const currency = field.config.currency || "$";
    const quantities: Record<string, number> = value ?? {};
    const setQty = (id: string, qty: number) => onChange({ ...quantities, [id]: Math.max(0, qty) });
    const total = products.reduce((sum, p) => {
      const qty = quantities[p.id] ?? 0;
      const discounted = p.price * (1 - (p.discountPct ?? 0) / 100);
      const taxed = discounted * (1 + (p.taxPct ?? 0) / 100);
      return sum + taxed * qty;
    }, 0);
    return (
      <div className="flex flex-col gap-2 max-w-sm">
        {products.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">{p.image && <img src={p.image} alt="" className="h-8 w-8 rounded object-cover" />}{p.name} — {currency}{p.price.toFixed(2)}</span>
            <input type="number" min={0} value={quantities[p.id] ?? 0} onChange={(e) => setQty(p.id, Number(e.target.value))} className="glass-input text-sm py-1 px-2 rounded-md w-16" />
          </div>
        ))}
        <p className="text-sm font-semibold text-right">Total: {currency}{total.toFixed(2)}</p>
      </div>
    );
  },
  isEmptyValue: (value) => !value || Object.values(value).every((q) => !q),
  formatValue: (value, field) => {
    if (!value) return "";
    const products: Product[] = field.config.products ?? [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return Object.entries(value as Record<string, number>)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => `${byId.get(id)?.name ?? id} × ${qty}`)
      .join(", ");
  },
};

export const BASIC_ELEMENTS: ElementDefinition[] = [
  headingElement,
  { type: "fullName", label: "Full Name", icon: User, category: "basic", kind: "field",
    defaultConfig: () => ({ showMiddleName: true, showSuffix: false }),
    CanvasPreview: ({ config }) => (
      <div className="flex gap-3">
        {["First Name", ...(config.showMiddleName !== false ? ["Middle Name"] : []), "Last Name", ...(config.showSuffix ? ["Suffix"] : [])].map((p) => (
          <div key={p} className="flex-1">
            <p className="text-[10px] text-slate-400 mb-0.5">{p}</p>
            <div className="border-b border-slate-300 h-5" />
          </div>
        ))}
      </div>
    ),
    PropertiesPanel: ({ field, onChange }) => (
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={field.config.showMiddleName !== false} onChange={(e) => onChange({ ...field, config: { ...field.config, showMiddleName: e.target.checked } })} /> Show Middle Name</label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={!!field.config.showSuffix} onChange={(e) => onChange({ ...field, config: { ...field.config, showSuffix: e.target.checked } })} /> Show Suffix</label>
      </div>
    ),
    FillInput: ({ field, value, onChange }) => {
      const v = value ?? {};
      const set = (k: string, val: string) => onChange({ ...v, [k]: val });
      return (
        <div className="flex gap-2 flex-wrap">
          <input type="text" placeholder="First name" value={v.first ?? ""} onChange={(e) => set("first", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md flex-1" />
          {field.config.showMiddleName !== false && <input type="text" placeholder="Middle" value={v.middle ?? ""} onChange={(e) => set("middle", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md w-24" />}
          <input type="text" placeholder="Last name" value={v.last ?? ""} onChange={(e) => set("last", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md flex-1" />
          {field.config.showSuffix && <input type="text" placeholder="Suffix" value={v.suffix ?? ""} onChange={(e) => set("suffix", e.target.value)} className="glass-input text-sm py-2 px-3 rounded-md w-20" />}
        </div>
      );
    },
    isEmptyValue: (value) => !value?.first?.trim() || !value?.last?.trim(),
    formatValue: (value) => [value?.first, value?.middle, value?.last, value?.suffix].filter((p) => p && String(p).trim()).join(" "),
  } satisfies ElementDefinition,
  emailElement,
  addressElement,
  phoneElement,
  datePickerElement,
  appointmentElement,
  signatureElement,
  fillInTheBlankElement,
  productListElement,
];
