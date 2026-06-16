# Username Login Feature

## Overview

Users can now login with either their **Email** OR **Username** for easier access.

### Username Format

Usernames are automatically generated from the user's display name:
- **Format**: `FirstName.LastName`
- **Example**: "Jhon Norban Rulona" → Username: `Jhon.Rulona`

The system takes the **first name** and **last name**, skipping any middle names.

---

## ✅ Changes Made

### 1. Updated User Profile Structure
**File**: `src/lib/firebase/users.ts`

- Added `username` field to `UserAccount` interface
- Created `generateUsername()` function to auto-generate usernames
- Added `getUserByUsername()` function to look up users by username + company ID
- Updated `createUserAccount()` to automatically generate and save username

### 2. Updated Login Form
**File**: `src/routes/landing.tsx`

- Changed "Email" field to "Email or Username"
- Updated placeholder: `"your.email@company.com or FirstName.LastName"`
- Changed "Remember my email" to "Remember my credentials"
- Added logic to detect if input is email (contains @) or username
- If username, looks up email from Firestore before authenticating

### 3. Updated SuperAdmin Dashboard
**File**: `src/routes/superadmin.tsx`

- Added real-time username preview when entering full name
- Shows: "Username will be: FirstName.LastName" below name field
- Username column already shows in the user table

---

## How It Works

### User Creation Flow

1. Admin enters user's **Full Name**: "Jhon Norban Rulona"
2. System automatically generates username: `Jhon.Rulona`
3. Username preview shows below name field in real-time
4. When saved, username is stored in Firestore user profile

### Login Flow

1. User enters either:
   - **Email**: `jhon.r@usinhomeservices.com`
   - **Username**: `Jhon.Rulona`

2. System detects input type:
   ```typescript
   const isEmail = input.includes('@');
   ```

3. **If Email**: Login directly with Firebase Auth
4. **If Username**: 
   - Look up user in Firestore by username + company ID
   - Get the associated email
   - Login with Firebase Auth using the email

---

## Examples

### Team Member Usernames

| Full Name | Username | Email |
|-----------|----------|-------|
| Jhon Norban Rulona | `Jhon.Rulona` | jhon.r@usinhomeservices.com |
| Aleena Hii | `Aleena.Hii` | aleena.hii@usinhomeservices.com |
| Lou Basco | `Lou.Basco` | lou.basco@usinhomeservices.com |
| Jerich Leonard | `Jerich.Leonard` | jerich.leonard@usinhomeservices.com |
| Daven Hodge | `Daven.Hodge` | daven.hodge@usinhomeservices.com |
| Jonathon Allen | `Jonathon.Allen` | jonathon.allen@usinhomeservices.com |
| Justin Parker | `Justin.Parker` | justin.parker@usinhomeservices.com |
| Raul Bayuyos Jr | `Raul.Jr` | raul.bayuyos@usinhomeservices.com |
| Naveen Lakhani | `Naveen.Lakhani` | naveen.lakhani@usinhomeservices.com |
| Krista Griffiss | `Krista.Griffiss` | krista.griffiss@usinhomeservices.com |
| Ian Montesclaros | `Ian.Montesclaros` | ian.montesclaros@usinhomeservices.com |

### Login Examples

#### Option 1: Login with Email
```
Email or Username: jhon.r@usinhomeservices.com
Password: Welcome2024!
Company ID: COMP001
```

#### Option 2: Login with Username
```
Email or Username: Jhon.Rulona
Password: Welcome2024!
Company ID: COMP001
```

Both options work identically!

---

## Technical Details

### Username Generation Function

```typescript
export function generateUsername(displayName: string): string {
  const nameParts = displayName.trim().split(/\s+/);
  
  if (nameParts.length === 0) {
    return "";
  }
  
  if (nameParts.length === 1) {
    // If only one name, use it as username
    return nameParts[0];
  }
  
  // First name + Last name (skip middle names)
  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];
  
  return `${firstName}.${lastName}`;
}
```

### Username Lookup Function

```typescript
export async function getUserByUsername(
  username: string,
  companyId: string
): Promise<UserAccount | null> {
  const usersRef = collection(db, "users");
  const q = query(
    usersRef,
    where("username", "==", username),
    where("companyId", "==", companyId),
    where("isActive", "==", true)
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    return null;
  }

  return snapshot.docs[0].data() as UserAccount;
}
```

### Login Detection Logic

```typescript
const isEmail = form.emailOrUsername.includes('@');

if (isEmail) {
  // Login with email directly
  await login(form.emailOrUsername, form.password);
} else {
  // It's a username - look up email first
  const user = await getUserByUsername(form.emailOrUsername, form.company);
  
  if (!user) {
    setErr(`User "${form.emailOrUsername}" not found in company ${form.company}`);
    return;
  }
  
  // Login with the found email
  await login(user.email, form.password);
}
```

---

## Security Considerations

### 1. Company ID Required
- Username lookup requires both username AND company ID
- Prevents cross-company username conflicts
- User "John.Smith" in COMP001 is different from "John.Smith" in COMP002

### 2. Active Users Only
- Only searches for users with `isActive: true`
- Deactivated users cannot login via username

### 3. Firestore Query
- Uses indexed Firestore query for fast lookup
- Compound index on: `username`, `companyId`, `isActive`

### 4. Case Sensitivity
- Usernames are case-sensitive
- "Jhon.Rulona" ≠ "jhon.rulona"
- Stored exactly as generated from display name

---

## Firestore Index Required

For optimal performance, create this Firestore composite index:

**Collection**: `users`
**Fields**:
1. `username` (Ascending)
2. `companyId` (Ascending)
3. `isActive` (Ascending)

Firebase will prompt you to create this index automatically when first querying.

---

## User Experience Benefits

### ✅ Easier to Remember
- `Jhon.Rulona` is easier than `jhon.r@usinhomeservices.com`
- No need to remember full email address
- Natural format based on actual name

### ✅ Faster to Type
- Shorter than email addresses
- No @ symbol or domain needed
- Works great on mobile devices

### ✅ Professional
- Clean, professional appearance
- Matches common enterprise username formats
- Similar to Slack, Microsoft Teams, etc.

### ✅ Flexible
- Users can choose which they prefer
- Both options always available
- No training needed - both work the same

---

## Testing

### Test Login with Username

1. Go to: http://localhost:8080/landing
2. Enter credentials:
   - **Email or Username**: `Jhon.Rulona`
   - **Password**: (your password)
   - **Company ID**: `COMP001`
3. Click "Sign in"
4. Should successfully authenticate and redirect

### Test Login with Email

1. Go to: http://localhost:8080/landing
2. Enter credentials:
   - **Email or Username**: `jhon.r@usinhomeservices.com`
   - **Password**: (your password)
   - **Company ID**: `COMP001`
3. Click "Sign in"
4. Should successfully authenticate and redirect

Both methods should work identically!

---

## Troubleshooting

### "User not found" Error

**Problem**: Login with username shows "User 'Username' not found"

**Solutions**:
1. Check company ID is correct
2. Verify username spelling (case-sensitive)
3. Confirm user exists in Firestore with `username` field
4. Check user has `isActive: true`

### Username Not Shown

**Problem**: Existing users don't have usernames

**Solution**: Re-save users in SuperAdmin dashboard to auto-generate usernames. Or run this Firestore update:

```typescript
// For each existing user without username:
await updateDoc(userRef, {
  username: generateUsername(user.displayName)
});
```

### Firestore Index Error

**Problem**: "The query requires an index"

**Solution**: Click the link in the Firebase error message to auto-create the index, or manually create it in Firebase Console.

---

## Future Enhancements

### Potential Improvements

1. **Case-Insensitive Username Search**
   - Convert to lowercase for matching
   - Store both original and lowercase versions

2. **Custom Usernames**
   - Allow users to customize their username
   - Check for uniqueness within company

3. **Username Change**
   - Allow users to change username
   - Keep username history for auditing

4. **Username Availability Check**
   - Real-time check if username is taken
   - Suggest alternatives if duplicate

5. **Forgot Username Feature**
   - Email user their username
   - Show username on profile page

---

## Files Modified

### Updated Files:
- ✅ `src/lib/firebase/users.ts` - Added username field and functions
- ✅ `src/routes/landing.tsx` - Updated login form for email/username
- ✅ `src/routes/superadmin.tsx` - Added username preview

### New Files:
- ✅ `USERNAME_LOGIN_FEATURE.md` - This documentation

---

**Feature Status**: ✅ Complete and Ready for Use

**Last Updated**: June 16, 2026
