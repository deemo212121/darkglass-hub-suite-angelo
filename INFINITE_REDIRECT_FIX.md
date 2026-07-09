# Infinite Redirect Loop Fix

## Problem
After successful Google Sign-In, the app entered an infinite redirect loop with error:
```
Error: Maximum update depth exceeded. This can happen when a component 
repeatedly calls setState inside componentWillUpdate or componentDidUpdate.
```

## Root Cause
The infinite loop was caused by two issues:

### Issue 1: Role Mismatch
- Firebase stored role as `"SUPERADMIN"` (uppercase) in Firestore
- Auth context (`auth.tsx`) was looking up role from hardcoded `EMAIL_TO_ROLE` map
- The map didn't include the Firebase email or had lowercase "superadmin"
- Role wasn't properly set, causing navigation confusion

### Issue 2: Navigation Loop
- `landing.tsx` used `useEffect` to navigate after login
- The effect watched `[ready, email, navigate]` dependencies
- After navigation, the component didn't unmount immediately
- State updates triggered the effect again → navigation → loop

## Solution

### Fix 1: Pass Firebase Role to Auth Context (`auth.tsx`)
Added optional `role` parameter to `login()` function:

```typescript
// Before
login: (email: string, companyId: string) => void;

// After
login: (email: string, companyId: string, role?: string) => void;
```

Implementation:
- Accept Firebase role directly when provided
- Fallback to email mapping for demo accounts
- Store role in `localStorage` for persistence
- Load role from `localStorage` on app initialization

### Fix 2: Use Declarative Navigation (`landing.tsx`)
Replaced imperative `useEffect` navigation with declarative `<Navigate>`:

```typescript
// Before (imperative - causes loops)
useEffect(() => {
  if (ready && email) {
    navigate({ to: "/home", replace: true });
  }
}, [ready, email, navigate]);

// After (declarative - no loops)
if (ready && email) {
  return <Navigate to="/home" replace />;
}
```

Benefits of declarative navigation:
- Component renders once with redirect
- React Router handles navigation immediately
- Component unmounts when navigating away
- No lingering effects that could re-trigger

### Fix 3: Update Login Handlers (`landing.tsx`)
Pass Firebase role when calling `login()`:

```typescript
// handleFirebaseLogin
const user = await signIn(form.email, form.password);
login(user.email, user.companyId, user.role); // ← Pass role

// handleGoogleSignIn
const user = await signInWithGoogle();
login(user.email, user.companyId, user.role); // ← Pass role
```

## Navigation Flow (After Fix)

1. **User logs in** (Google or email/password)
2. **Firebase returns** `{ email, companyId, role: "SUPERADMIN" }`
3. **`login()` called** with all three parameters
4. **Auth context updates** `email`, `companyId`, `role` in state + localStorage
5. **Component re-renders** → `if (ready && email)` is true
6. **Returns** `<Navigate to="/home" replace />`
7. **React Router navigates** → `landing.tsx` unmounts
8. **`/home` route renders** → checks `role?.toLowerCase() === "superadmin"` ✅
9. **Returns** `<Navigate to="/superadmin" replace />`
10. **`/superadmin` route renders** → checks `role?.toLowerCase() !== "superadmin"` ✅
11. **Success!** User sees SuperAdmin Dashboard

## Files Modified

1. **`src/lib/auth.tsx`**
   - Added `role?: string` parameter to `login()` function
   - Store role in localStorage
   - Load role from localStorage on initialization
   - Listen for role changes in storage events

2. **`src/routes/landing.tsx`**
   - Replaced `useEffect` navigation with declarative `<Navigate>`
   - Pass Firebase role to `login()` in both handlers

## Testing

Test scenarios:
1. ✅ Google Sign-In with SuperAdmin account
2. ✅ Email/password login with Firebase account
3. ✅ Demo mode login (uses email mapping)
4. ✅ Page reload (role persists via localStorage)
5. ✅ Multiple login/logout cycles

## Notes

- Role checks are case-insensitive: `role?.toLowerCase() === "superadmin"`
- Demo accounts still use `EMAIL_TO_ROLE` mapping
- Firebase accounts use Firestore role directly
- Role persists across page reloads via localStorage
- COOP warnings are harmless (browser security policy)

## Related Files

- `src/routes/home.tsx` - SuperAdmin redirect logic
- `src/routes/superadmin.tsx` - Role guard
- `src/routes/index.tsx` - Initial route redirect
- `src/lib/firebase/auth.ts` - Firebase authentication
- `src/lib/firebase/firestore.ts` - User profile storage
