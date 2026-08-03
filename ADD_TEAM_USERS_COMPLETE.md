# Add Team Users to Firebase - Complete Guide

## ✅ Changes Made

### 1. Updated SuperAdmin Dashboard
- **Added all user roles** to the User Type dropdown:
  - SUPERADMIN
  - ADMIN
  - MANAGER
  - CSR (Customer Service)
  - TECHNICIAN
  - DISPATCHER
  - HR (Human Resources)
  - IT Support
  - PARTS (Parts Management)
  - FINANCE

- **Updated user list** to show ALL users (not just ADMINs)
  - Filters out only SUPERADMIN from the list
  - Shows all other roles: ADMIN, MANAGER, CSR, TECHNICIAN, etc.

- **Added Role column** to the user table
  - Now displays: Email, Username, Name, **Role**, Contact, Company ID, Company Name, Status, Created, Actions
  - Role is displayed in a blue badge for easy identification

- **Updated labels**:
  - Changed "Admin Accounts" to "User Accounts"
  - Updated placeholder text to reflect all user types

### 2. Created Documentation Files

#### `TEAM_USERS_TO_ADD.md`
Complete list of 10 team members to add with all details:
- Full names
- Email addresses
- Default password (Welcome2024!)
- Phone numbers
- Roles
- Departments
- Employee IDs

#### `scripts/add-team-users.ts`
Automated script to bulk-create all 10 users in Firebase

---

## 📋 Team Members to Add

| # | Name | Email | Role | Department |
|---|------|-------|------|------------|
| 1 | Aleena Hii | aleena.hii@usinhomeservices.com | CSR | Customer Service |
| 2 | Lou Basco | lou.basco@usinhomeservices.com | TECHNICIAN | Field Operations |
| 3 | Jerich Leonard | jerich.leonard@usinhomeservices.com | TECHNICIAN | Field Operations |
| 4 | Daven Hodge | daven.hodge@usinhomeservices.com | TECHNICIAN | Field Operations |
| 5 | Jonathon Allen | jonathon.allen@usinhomeservices.com | TECHNICIAN | Field Operations |
| 6 | Justin Parker | justin.parker@usinhomeservices.com | TECHNICIAN | Field Operations |
| 7 | Raul Bayuyos Jr | raul.bayuyos@usinhomeservices.com | TECHNICIAN | Field Operations |
| 8 | Naveen Lakhani | naveen.lakhani@usinhomeservices.com | MANAGER | Operations Management |
| 9 | Krista Griffiss | krista.griffiss@usinhomeservices.com | HR | Human Resources |
| 10 | Ian Montesclaros | ian.montesclaros@usinhomeservices.com | PARTS | Parts Management |

**Default Password for All**: `Welcome2024!`

---

## 🚀 How to Add Users

### Method 1: SuperAdmin Dashboard (Recommended) ✨

1. **Login as SuperAdmin**
   - Go to: http://localhost:8080/landing
   - Email: `superadmin@ahsolutions.com`
   - Password: (your superadmin password)
   - Company ID: `COMP001`

2. **Navigate to SuperAdmin Dashboard**
   - After login, you'll be redirected to `/superadmin`
   - Or manually go to: http://localhost:8080/superadmin

3. **Add Each User**
   - Click **"+ Add New Admin"** button
   - Fill in the form using details from `TEAM_USERS_TO_ADD.md`:
     - Email: (copy from list)
     - Password: `Welcome2024!`
     - Display Name: (copy full name)
     - Phone Number: Select country code + enter number
     - User Type: Select role from dropdown (CSR, TECHNICIAN, MANAGER, HR, or PARTS)
     - Company: Select `COMP001`
   - Click **"Create Admin"**
   - Repeat for all 10 users

4. **Verify Users**
   - Check the "User Accounts" table
   - You should see all 10 users listed with their roles
   - Status should be "Active" (green badge)
   - Role should be displayed correctly

### Method 2: Automated Script 🤖

**Note**: This method requires updating the script with your actual SUPERADMIN UID first.

1. **Update the script**
   - Open `scripts/add-team-users.ts`
   - Replace `"SUPERADMIN_UID"` on line 128 with your actual superadmin user UID
   - You can find your UID in Firebase Console > Authentication

2. **Run the script**
   ```bash
   cd "c:\Users\user\Downloads\AH Solutions v3\darkglass-hub-suite"
   bun run scripts/add-team-users.ts
   ```

3. **Check output**
   - Script will show success/error for each user
   - Summary will show total created vs errors

### Method 3: Firebase Console (Manual) 🔥

1. **Go to Firebase Console**
   - https://console.firebase.google.com
   - Select your project

2. **Add Authentication**
   - Go to: Authentication > Users
   - Click "Add user"
   - Enter email and password
   - Click "Add user"
   - Repeat for all 10 users

3. **Add Firestore Profiles**
   - Go to: Firestore Database > users collection
   - Click "Add document"
   - Document ID: (use the UID from Authentication)
   - Add fields:
     ```
     uid: [string] (same as document ID)
     email: [string]
     displayName: [string]
     companyId: [string] "COMP001"
     role: [string] (CSR, TECHNICIAN, etc.)
     isActive: [boolean] true
     phoneNumber: [string]
     employeeId: [string]
     department: [string]
     permissions: [array]
     createdAt: [timestamp] (current time)
     createdBy: [string] (your superadmin UID)
     updatedAt: [timestamp] (current time)
     ```
   - Click "Save"
   - Repeat for all 10 users

---

## ✅ Verification Checklist

After adding all users, verify:

- [ ] All 10 users appear in SuperAdmin dashboard
- [ ] Each user has the correct role displayed
- [ ] All users have "Active" status
- [ ] Company ID is "COMP001" for all users
- [ ] Phone numbers are formatted correctly
- [ ] Email addresses are correct

### Test Login

Try logging in as one of the new users:

1. Logout from superadmin
2. Go to: http://localhost:8080/landing
3. Test credentials:
   - Email: `aleena.hii@usinhomeservices.com`
   - Password: `Welcome2024!`
   - Company ID: `COMP001`
4. Should successfully login and redirect based on role

---

## 🔐 Security Notes

1. **Default Password**: All users have the same password `Welcome2024!`
   - ⚠️ This is a TEMPORARY password
   - Users should change it on first login
   - Consider implementing forced password change

2. **Company ID**: All users belong to `COMP001`
   - This should match your actual company ID in production

3. **Role-Based Access**:
   - CSR: Customer service functions
   - TECHNICIAN: Field operations, work planner
   - MANAGER: Can access management features
   - HR: Payroll and HR dashboards
   - PARTS: Parts management features

4. **Email Domain**: All use `@usinhomeservices.com`
   - Update if your domain is different

---

## 📂 Files Modified

### Updated Files:
- `src/routes/superadmin.tsx`
  - Added all user roles to dropdown
  - Changed filter to show all users (not just ADMIN)
  - Added Role column to table
  - Updated labels and text

### New Files:
- `TEAM_USERS_TO_ADD.md` - User details reference
- `scripts/add-team-users.ts` - Bulk creation script
- `ADD_TEAM_USERS_COMPLETE.md` - This guide

---

## 🎯 Next Steps

After adding all users:

1. **Test Each Role**
   - Login as each role type
   - Verify they can access appropriate features
   - Check that role-based restrictions work

2. **Password Policy**
   - Implement forced password change on first login
   - Set password expiration policy
   - Enable two-factor authentication

3. **User Profiles**
   - Add profile pictures
   - Complete department assignments
   - Set up manager hierarchies

4. **Permissions**
   - Review and adjust granular permissions
   - Set up approval workflows
   - Configure module access

5. **Documentation**
   - Create user guides for each role
   - Document standard operating procedures
   - Set up onboarding process

---

## 🆘 Troubleshooting

### "Email already in use"
- User already exists in Firebase
- Check Authentication tab in Firebase Console
- Either skip or delete existing user first

### "Firebase not configured"
- Check `.env` file has all Firebase credentials
- Verify Firebase project is active
- Check internet connection

### "Company does not exist"
- Make sure company COMP001 exists
- Create company first if needed
- Check company ID spelling

### "Insufficient permissions"
- Make sure you're logged in as SUPERADMIN
- Check your user role in Firestore
- Verify Firebase security rules

### User can't login
- Verify email and password in Firebase Authentication
- Check Firestore user profile exists
- Verify `isActive` is set to `true`
- Check company ID matches

---

## 📞 Support

If you encounter issues:
1. Check Firebase Console for authentication errors
2. Review browser console for JavaScript errors
3. Check Firestore security rules
4. Verify environment variables in `.env`

---

**Last Updated**: June 16, 2026
**Status**: Ready for implementation ✅
