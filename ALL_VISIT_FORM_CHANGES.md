# All Visit Form Changes - Implementation Guide

## Changes Completed ✅
1. **Visit Details Table** - REMOVED (hardcoded table showing V1, Danny Thornton, etc.)

## Changes Needed

### 1. Time Slot Field - Make Required
**Line ~2032**
Change:
```tsx
<label htmlFor="visit-time-slot-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Time Slot</label>
```
To:
```tsx
<label htmlFor="visit-time-slot-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Time Slot *</label>
```

### 2. Remove Activity Field
**Lines ~2038-2041** - DELETE these lines:
```tsx
<div className="space-y-1.5">
  <label htmlFor="visit-activity-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Activity</label>
  <input id="visit-activity-modal" type="text" value={newVisitActivity} onChange={(event) => setNewVisitActivity(event.target.value)} placeholder="e.g. 1.0 hr" className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500" />
</div>
```

### 3. Update Action Type Options
**Lines ~2043-2051** - Replace the options with:
```tsx
<option value="">— select —</option>
<option>SCHEDULE</option>
<option>ACKNOWLEDGE</option>
<option>CALL ATTEMPT</option>
<option>CANCEL</option>
<option>CLAIM REQUESTED</option>
<option>COMPLETED</option>
<option>OSR</option>
<option>UPDATE INFO.</option>
<option>UPDATE</option>
<option>RESCHEDULE</option>
<option>TRIAGE</option>
<option>SUPPORT</option>
```

### 4. Remove Reclaim Field
**Lines ~2077-2080** - DELETE these lines:
```tsx
<div className="space-y-1.5">
  <label htmlFor="visit-reclaim-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Reclaim</label>
  <input id="visit-reclaim-modal" type="text" value={newVisitReclaim} onChange={(event) => setNewVisitReclaim(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
</div>
```

### 5. Remove Visited Field
**Lines ~2081-2088** - DELETE these lines:
```tsx
<div className="space-y-1.5">
  <label htmlFor="visit-visited-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Visited</label>
  <select id="visit-visited-modal" value={newVisitVisited} onChange={(event) => setNewVisitVisited(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500">
    <option value="">— select —</option>
    <option>Visited</option>
    <option>Not Visited</option>
  </select>
</div>
```

### 6. Remove Not Completed? Field
**Lines ~2089-2092** - DELETE these lines:
```tsx
<div className="space-y-1.5">
  <label htmlFor="visit-not-completed-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Not Completed?</label>
  <input id="visit-not-completed-modal" type="text" value={newVisitNotCompleted} onChange={(event) => setNewVisitNotCompleted(event.target.value)} className="w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
</div>
```

### 7. Add Sched Notes (CSR) Field
**After Repair Type field (line ~2076), ADD:**
```tsx
<div className="space-y-1.5 xl:col-span-3">
  <label htmlFor="visit-sched-notes-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Sched Notes (CSR)</label>
  <textarea id="visit-sched-notes-modal" value={newVisitSchedNotes} onChange={(event) => setNewVisitSchedNotes(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
</div>
```

### 8. Update Symptom (Cx) to Symptom (CSR)
**Line ~2094** - Change label:
```tsx
<label htmlFor="visit-symptom-cx-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Symptom (CSR)</label>
```

### 9. Update Diagnosis to Cause of Failure (Tech)
**Line ~2098** - Change label:
```tsx
<label htmlFor="visit-diagnosis-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Cause of Failure (Tech)</label>
```

### 10. Remove Symptom (Tech) Field
**Lines ~2102-2105** - DELETE these lines:
```tsx
<div className="space-y-1.5 xl:col-span-3">
  <label htmlFor="visit-symptom-tech-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Symptom (Tech)</label>
  <textarea id="visit-symptom-tech-modal" value={newVisitSymptomTech} onChange={(event) => setNewVisitSymptomTech(event.target.value)} className="min-h-18 w-full rounded-md border border-white/15 bg-slate-950/90 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
</div>
```

### 11. Update Resolution to Repair Notes (Tech)
**Line ~2107** - Change label:
```tsx
<label htmlFor="visit-resolution-modal" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Repair Notes (Tech)</label>
```

### 12. Update Visit History Display Order
Find the Visit History map function (around line ~1950) and change:
```tsx
visitLogEntries.map((entry) => ...
```
To:
```tsx
[...visitLogEntries].reverse().map((entry) => ...
```

### 13. Update Validation to Require Time Slot
Find the `addVisitLogEntry` function validation (around line ~900) and change:
```tsx
if (!newVisitScheduleDate || !newVisitTechnician) return;
```
To:
```tsx
if (!newVisitScheduleDate || !newVisitTechnician || !newVisitTimeSlot) return;
```

### 14. Add schedNotes State Variable
Find state variables section (around line ~720) and add:
```tsx
const [newVisitSchedNotes, setNewVisitSchedNotes] = useState("");
```

### 15. Update clearVisitForm Function
Add to the function (around line ~870):
```tsx
setNewVisitSchedNotes("");
```

### 16. Update loadVisitForEdit Function
Add to the function (around line ~890):
```tsx
setNewVisitSchedNotes((entry as any).schedNotes || "");
```

### 17. Update Visit Entry Creation
In addVisitLogEntry function, add:
```tsx
(visitEntry as any).schedNotes = newVisitSchedNotes;
```

### 18. Update Default Action Type
Find where `newVisitActionType` state is initialized (around line ~722) and change:
```tsx
const [newVisitActionType, setNewVisitActionType] = useState("Visited");
```
To:
```tsx
const [newVisitActionType, setNewVisitActionType] = useState("SCHEDULE");
```

## Summary
- Remove: Activity, Reclaim, Visited, Not Completed?, Symptom (Tech) fields
- Add: Sched Notes (CSR) field
- Update: 4 field labels, Action Type options, Time Slot to required
- Fix: Visit History order (chronological)
- Update: Validation, state management, default values

All these changes are in: `src/routes/ticket.$ticketNo.tsx`
