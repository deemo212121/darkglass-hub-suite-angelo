# SuperAdmin System Documentation

## Overview
The SuperAdmin system provides a separate administrative interface for managing company admin accounts across the platform. SuperAdmins have their own dedicated dashboard and cannot access the regular module-based home panel.

## Features

### 1. **Separate Login & Dashboard**
- SuperAdmins log in using `superadmin@ahsolutions.com`
- Automatically redirected to `/superadmin` dashboard (not the regular home panel)
- Clean, focused interface showing only admin management

### 2. **Admin Account Management**
SuperAdmins can manage company admin accounts with the following fields:

#### Required Fields:
- **Email**: Admin's email address
- **Username**: Unique username for the admin
- **Full Name**: Admin's full name
- **Company ID**: Unique identifier for the company

#### Optional Fields:
- **Contact Number**: Admin's phone number
- **Company Name**: Name of the company

### 3. **Admin Operations**
- ✅ **Add New Admin**: Create new admin accounts with full details
- ✅ **Edit Admin**: Update existing admin information
- ✅ **Delete Admin**: Remove admin accounts (with confirmation)
- ✅ **Toggle Status**: Switch between Active/Inactive status
- ✅ **View All Admins**: Comprehensive table with all admin details

### 4. **Data Storage**
- All admin data stored in localStorage: `ahs:superadmin:admins`
- Persists across sessions
- Includes creation timestamp for each admin

## Usage

### Login as SuperAdmin
1. Go to landing page (http://localhost:8080/landing)
2. Click "Login"
3. Select "superadmin@ahsolutions.com" from dropdown
4. Enter any password (demo mode)
5. Select Company ID
6. Click "Sign in"
7. Automatically redirected to `/superadmin` dashboard

### Add New Admin
1. Click "Add New Admin" button
2. Fill in required fields (Email, Username, Name, Company ID)
3. Optionally fill in Contact Number and Company Name
4. Click "Create Admin"
5. New admin appears in the table

### Edit Admin
1. Click "Edit" button next to any admin
2. Form populates with current data
3. Modify any fields
4. Click "Update Admin"

### Toggle Status
1. Click the status badge (Active/Inactive) next to any admin
2. Status toggles immediately
3. Visual indicator changes color (green for Active, red for Inactive)

### Delete Admin
1. Click "Delete" button next to any admin
2. Confirm deletion in popup
3. Admin removed from list

## Admin Table Columns

| Column | Description |
|--------|-------------|
| Email | Admin's email address |
| Username | Unique username |
| Name | Full name of the admin |
| Contact | Phone number (if provided) |
| Company ID | Unique company identifier |
| Company Name | Company name (if provided) |
| Status | Active or Inactive badge (clickable) |
| Created | Date when admin was created |
| Actions | Edit and Delete buttons |

## Security Notes

### Current Implementation (Demo):
- Any password works for demo purposes
- SuperAdmin role checked via email mapping in `auth.tsx`
- Route protection: Non-superadmins redirected away from `/superadmin`

### Production Considerations:
- Implement proper authentication
- Add password requirements and hashing
- Add email verification for new admins
- Add audit logging for all SuperAdmin actions
- Consider multi-factor authentication
- Add session timeout
- Implement password reset flow

## Technical Details

### Files Created/Modified:
1. **`src/routes/superadmin.tsx`** - SuperAdmin dashboard component
2. **`src/lib/auth.tsx`** - Already had SuperAdmin support
3. **`src/routes/home.tsx`** - Added SuperAdmin redirect logic
4. **`src/routes/landing.tsx`** - SuperAdmin already in email list

### Data Structure:
```typescript
interface AdminAccount {
  id: string;                    // UUID
  email: string;                 // Admin email
  username: string;              // Username
  name: string;                  // Full name
  contactNumber: string;         // Phone
  companyId: string;             // Company ID
  companyName: string;           // Company name
  createdAt: string;             // ISO timestamp
  status: "Active" | "Inactive"; // Account status
}
```

### localStorage Key:
```
ahs:superadmin:admins
```

## Future Enhancements

### Potential Features:
1. **Email Notifications**: Send welcome emails to new admins
2. **Password Management**: Password reset functionality
3. **Permissions**: Granular permissions per company
4. **Audit Log**: Track all SuperAdmin actions
5. **Bulk Operations**: Add/edit/delete multiple admins
6. **Search & Filter**: Search admins by email, company, status
7. **Export**: Export admin list to CSV/Excel
8. **Company Management**: Separate company management interface
9. **Usage Analytics**: Track admin login frequency and activity
10. **Two-Factor Auth**: Add 2FA for SuperAdmin accounts

## Testing

### Test Flow:
1. Login as `superadmin@ahsolutions.com`
2. Verify redirect to `/superadmin`
3. Add a test admin account
4. Edit the admin account
5. Toggle status Active ↔ Inactive
6. Delete the admin account
7. Verify data persists after page reload
8. Logout and verify regular users cannot access `/superadmin`

## Screenshots Reference

### SuperAdmin Dashboard:
- Header shows "SuperAdmin Dashboard" title
- User info displays logged-in SuperAdmin email
- Purple "SuperAdmin" badge
- "Add New Admin" button
- Admin table with all accounts

### Add/Edit Form:
- 2-column grid layout
- Required fields marked with *
- Email, Username, Name, Contact, Company ID, Company Name
- "Create Admin" or "Update Admin" button
- "Cancel" button

### Admin Table:
- Responsive table with horizontal scroll
- Color-coded status badges
- Inline Edit/Delete buttons
- Creation date displayed
- Hover effects for better UX

## Conclusion

The SuperAdmin system provides a complete administrative interface for managing company admin accounts. It's isolated from the regular user interface and provides dedicated functionality for platform administration.
