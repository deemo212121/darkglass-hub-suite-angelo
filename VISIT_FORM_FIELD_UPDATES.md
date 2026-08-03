# Visit Form Field Updates

## Changes Summary
Updated field labels and requirements in the Add Visit / Edit Visit form for better clarity and workflow alignment.

## Field Changes

### 1. **Time Slot** - Now Required
- **Before**: Optional field
- **After**: Required field (marked with *)
- **Reason**: Time slot is essential for scheduling and work planning
- **Validation**: Form won't submit without selecting AM, PM, or ALL DAY

### 2. **Symptom (Cx)** → **Symptom (CSR)**
- **Label Changed**: "Symptom (Cx)" to "Symptom (CSR)"
- **Reason**: Clarifies that CSR (Customer Service Representative) records customer-reported symptoms
- **Field**: Textarea for customer symptom descriptions

### 3. **Diagnosis** → **Cause of Failure (Tech)**
- **Label Changed**: "Diagnosis" to "Cause of Failure (Tech)"
- **Reason**: More specific terminology - technician identifies what caused the failure
- **Field**: Textarea for technical diagnosis

### 4. **Resolution** → **Repair Notes (Tech)**
- **Label Changed**: "Resolution" to "Repair Notes (Tech)"
- **Reason**: Clearer indication that technician documents repair actions taken
- **Field**: Textarea for repair documentation

### 5. **Symptom (Tech)** - REMOVED
- **Action**: Field completely removed
- **Reason**: Redundant with "Cause of Failure (Tech)" field
- **Impact**: Streamlines form and reduces confusion

### 6. **Sched Notes (CSR)** - NEW FIELD ADDED
- **Action**: New textarea field added
- **Label**: "Sched Notes (CSR)"
- **Purpose**: CSR can add scheduling-specific notes
- **Position**: Added between "Repair Type (2nd Tech)" and "Symptom (CSR)"
- **Field**: Textarea for scheduling notes

## Updated Field Order

### Required Fields (*)
1. Schedule Date *
2. Technician *
3. **Time Slot *** ← Now required
4. Action Type *
5. Repair Status *

### Optional Fields (in order)
6. Repair Type (2nd Tech)
7. **Sched Notes (CSR)** ← NEW
8. **Symptom (CSR)** ← Renamed from "Symptom (Cx)"
9. **Cause of Failure (Tech)** ← Renamed from "Diagnosis"
10. **Repair Notes (Tech)** ← Renamed from "Resolution"
11. Non-Completion Reason
12. Triage Note
13. Internal Note

## Role-Based Field Clarity

### CSR (Customer Service Representative) Fields:
- **Sched Notes (CSR)** - Scheduling-specific notes
- **Symptom (CSR)** - Customer-reported symptoms

### Tech (Technician) Fields:
- **Cause of Failure (Tech)** - Technical diagnosis of the problem
- **Repair Notes (Tech)** - Actions taken to fix the issue
- **Repair Type (2nd Tech)** - Secondary technician repair classification

This naming convention makes it immediately clear who is responsible for filling out each field.

## Validation Changes

### New Required Field Validation:
```typescript
if (!newVisitScheduleDate || !newVisitTechnician || !newVisitTimeSlot) return;
```

Before submitting, the form now checks that:
- Schedule Date is filled
- Technician is selected
- **Time Slot is selected** ← NEW

## Data Model Updates

### New Field Added:
- `schedNotes: string` - Stored as custom property on visit entry

### Field Mapping:
- `symptomCx` → "Symptom (CSR)" label
- `diagnosis` → "Cause of Failure (Tech)" label
- `resolution` → "Repair Notes (Tech)" label
- `symptomTech` → Still in data model but removed from UI
- `schedNotes` → NEW field for scheduling notes

## Implementation Details

### State Variable Added:
```typescript
const [newVisitSchedNotes, setNewVisitSchedNotes] = useState("");
```

### Form Reset Updated:
```typescript
setNewVisitSchedNotes("");
```

### Load Visit for Edit Updated:
```typescript
setNewVisitSchedNotes((entry as any).schedNotes || "");
```

### Visit Entry Creation Updated:
```typescript
(visitEntry as any).schedNotes = newVisitSchedNotes;
```

## Benefits

1. **Clearer Responsibilities**: Role-based field names (CSR vs Tech)
2. **Better Scheduling**: Time Slot is now required for proper planning
3. **Reduced Redundancy**: Removed duplicate "Symptom (Tech)" field
4. **Enhanced Communication**: New "Sched Notes" for CSR scheduling notes
5. **Improved Workflow**: Fields align with actual business process

## Migration Notes

**Existing Visits**:
- Old visits with "symptomTech" data will retain that data in the database
- The field just won't be displayed or editable in the UI
- "schedNotes" will be empty for old visits

**New Visits**:
- Must have Time Slot selected
- Can use new "Sched Notes (CSR)" field
- "Symptom (Tech)" will be empty (field removed from form)

## Testing

### To Verify Changes:
1. Open Add Visit modal
2. Verify field labels are updated:
   - "Symptom (CSR)" not "Symptom (Cx)"
   - "Cause of Failure (Tech)" not "Diagnosis"
   - "Repair Notes (Tech)" not "Resolution"
3. Verify "Symptom (Tech)" field is removed
4. Verify "Sched Notes (CSR)" field exists
5. Try to submit without Time Slot - should fail validation
6. Fill all required fields including Time Slot - should save successfully

## Files Modified
- `src/routes/ticket.$ticketNo.tsx` - Updated field labels, added schedNotes, made Time Slot required

## Related Documentation
- `VISIT_ACTION_TYPE_UPDATE.md` - Action Type standardization
- `VISIT_FORM_CLEANUP.md` - Previous field removals
- `VISIT_HISTORY_ORDER_FIX.md` - Chronological display order
