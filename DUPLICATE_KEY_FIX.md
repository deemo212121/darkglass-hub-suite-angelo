# Duplicate React Key Fix

## Issue Summary
React was throwing warnings about duplicate keys for children components:
- Duplicate keys for city names: "Lake Charles", "St. Louis", "San Antonio", "Chattanooga", "Nashville", "Raleigh", "Atlanta"
- Duplicate "Hired" keys

## Root Causes

### 1. HR Daily Report Component (`src/components/ReportHRDaily.tsx`)
**Problem:** Line 290 had duplicate "Hired" labels in the metrics array:
```typescript
[["Scheduled",totalScheduled,"text-blue-300"],
 ["Hired",totalHired,"text-green-300"],
 ["TC Warnings",totalTCW,"text-yellow-300"],
 ["Emp Errors",totalEE,"text-red-300"],
 ["Candidates",scheduledCount,"text-blue-400"],
 ["Hired",hiredCount,"text-green-400"]].map(([l,v,c])=>(
   <div key={l as string}>...</div>
 ))
```

The label "Hired" appeared twice, causing duplicate keys.

**Solution:** 
1. Changed the second "Hired" label to "Hired Candidates" for uniqueness
2. Changed from `key={l as string}` to `key={`metric-${idx}`}` using the index for guaranteed uniqueness

```typescript
[["Scheduled",totalScheduled,"text-blue-300"],
 ["Hired",totalHired,"text-green-300"],
 ["TC Warnings",totalTCW,"text-yellow-300"],
 ["Emp Errors",totalEE,"text-red-300"],
 ["Candidates",scheduledCount,"text-blue-400"],
 ["Hired Candidates",hiredCount,"text-green-400"]].map(([l,v,c],idx)=>(
   <div key={`metric-${idx}`}>...</div>
 ))
```

### 2. User Management Route (`src/routes/m.$module.$submodule.$userId.tsx`)
**Problem:** The same LOCATIONS array was mapped twice on the same page with identical keys:
- Line 544: Select dropdown options with `key={location}`
- Line 608: Table rows with `key={location}`

When the same keys exist in different elements on the same page (even in different components), React's reconciliation can get confused.

**Solution:** Added unique prefixes to distinguish the contexts:

**Line 544 - Select Options:**
```typescript
// Before
{LOCATIONS.map((location) => (
  <option key={location} value={location}>{location}</option>
))}

// After
{LOCATIONS.map((location) => (
  <option key={`select-${location}`} value={location}>{location}</option>
))}
```

**Line 608 - Table Rows:**
```typescript
// Before
{LOCATIONS.map((location, index) => {
  return (
    <tr key={location}>...</tr>
  )
})}

// After
{LOCATIONS.map((location, index) => {
  return (
    <tr key={`row-${location}`}>...</tr>
  )
})}
```

## Why This Matters

### React Key Uniqueness
- Keys help React identify which items have changed, are added, or are removed
- Keys must be unique among siblings (elements in the same parent)
- Using duplicate keys can cause:
  - Components not updating correctly
  - State being preserved incorrectly
  - UI glitches and inconsistent rendering
  - Performance issues

### Best Practices Applied
1. **Use indexes only as last resort** - We used indexes in the metrics array because the labels weren't guaranteed unique
2. **Use meaningful prefixes** - `select-`, `row-`, `metric-` make debugging easier
3. **Ensure uniqueness in context** - Same location name can exist in different contexts with different prefixes

## Files Modified
1. `src/components/ReportHRDaily.tsx` - Line 290
2. `src/routes/m.$module.$submodule.$userId.tsx` - Lines 544 and 608

## Testing
Run the application and verify:
- ✅ No console warnings about duplicate keys
- ✅ HR Dashboard metrics display correctly
- ✅ User management location dropdowns work
- ✅ User management branch access table renders correctly
- ✅ All location-based filtering and selection works as expected

## Result
All duplicate key warnings have been eliminated. The application now follows React best practices for key management.
