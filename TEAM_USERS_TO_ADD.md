# Team Users to Add to Firebase

Use the SuperAdmin dashboard to add these users manually, or run the script `scripts/add-team-users.ts`.

## Users List

### 1. Aleena Hii
- **Email**: aleena.hii@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Aleena Hii
- **Company ID**: COMP001
- **Role**: CSR
- **Phone**: +63 9123456701
- **Department**: Customer Service
- **Employee ID**: EMP-CSR-001

### 2. Lou Basco
- **Email**: lou.basco@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Lou Basco
- **Company ID**: COMP001
- **Role**: TECHNICIAN
- **Phone**: +63 9123456702
- **Department**: Field Operations
- **Employee ID**: EMP-TECH-001

### 3. Jerich Leonard
- **Email**: jerich.leonard@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Jerich Leonard
- **Company ID**: COMP001
- **Role**: TECHNICIAN
- **Phone**: +63 9123456703
- **Department**: Field Operations
- **Employee ID**: EMP-TECH-002

### 4. Daven Hodge
- **Email**: daven.hodge@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Daven Hodge
- **Company ID**: COMP001
- **Role**: TECHNICIAN
- **Phone**: +1 9045551001
- **Department**: Field Operations
- **Employee ID**: EMP-TECH-003

### 5. Jonathon Allen
- **Email**: jonathon.allen@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Jonathon Allen
- **Company ID**: COMP001
- **Role**: TECHNICIAN
- **Phone**: +1 2515551002
- **Department**: Field Operations
- **Employee ID**: EMP-TECH-004

### 6. Justin Parker
- **Email**: justin.parker@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Justin Parker
- **Company ID**: COMP001
- **Role**: TECHNICIAN
- **Phone**: +1 6155551003
- **Department**: Field Operations
- **Employee ID**: EMP-TECH-005

### 7. Raul Bayuyos Jr
- **Email**: raul.bayuyos@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Raul Bayuyos Jr
- **Company ID**: COMP001
- **Role**: TECHNICIAN
- **Phone**: +63 9123456704
- **Department**: Field Operations
- **Employee ID**: EMP-TECH-006

### 8. Naveen Lakhani
- **Email**: naveen.lakhani@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Naveen Lakhani
- **Company ID**: COMP001
- **Role**: MANAGER
- **Phone**: +1 9015551004
- **Department**: Operations Management
- **Employee ID**: EMP-MGR-001

### 9. Krista Griffiss
- **Email**: krista.griffiss@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Krista Griffiss
- **Company ID**: COMP001
- **Role**: HR
- **Phone**: +1 9015551005
- **Department**: Human Resources
- **Employee ID**: EMP-HR-001

### 10. Ian Montesclaros
- **Email**: ian.montesclaros@usinhomeservices.com
- **Password**: Welcome2024!
- **Display Name**: Ian Montesclaros
- **Company ID**: COMP001
- **Role**: PARTS
- **Phone**: +63 9123456705
- **Department**: Parts Management
- **Employee ID**: EMP-PARTS-001

---

## Quick Copy Format (for manual entry)

```
aleena.hii@usinhomeservices.com | Welcome2024! | Aleena Hii | COMP001 | CSR
lou.basco@usinhomeservices.com | Welcome2024! | Lou Basco | COMP001 | TECHNICIAN
jerich.leonard@usinhomeservices.com | Welcome2024! | Jerich Leonard | COMP001 | TECHNICIAN
daven.hodge@usinhomeservices.com | Welcome2024! | Daven Hodge | COMP001 | TECHNICIAN
jonathon.allen@usinhomeservices.com | Welcome2024! | Jonathon Allen | COMP001 | TECHNICIAN
justin.parker@usinhomeservices.com | Welcome2024! | Justin Parker | COMP001 | TECHNICIAN
raul.bayuyos@usinhomeservices.com | Welcome2024! | Raul Bayuyos Jr | COMP001 | TECHNICIAN
naveen.lakhani@usinhomeservices.com | Welcome2024! | Naveen Lakhani | COMP001 | MANAGER
krista.griffiss@usinhomeservices.com | Welcome2024! | Krista Griffiss | COMP001 | HR
ian.montesclaros@usinhomeservices.com | Welcome2024! | Ian Montesclaros | COMP001 | PARTS
```

---

## Role Breakdown

- **CSR** (Customer Service Representative): 1 user
  - Aleena Hii

- **TECHNICIAN** (Field Technicians): 6 users
  - Lou Basco
  - Jerich Leonard
  - Daven Hodge
  - Jonathon Allen
  - Justin Parker
  - Raul Bayuyos Jr

- **MANAGER** (Operations Manager): 1 user
  - Naveen Lakhani

- **HR** (Human Resources): 1 user
  - Krista Griffiss

- **PARTS** (Parts Management): 1 user
  - Ian Montesclaros

---

## Instructions

### Option 1: Using SuperAdmin Dashboard (Recommended)
1. Log in as superadmin@ahsolutions.com
2. Go to `/superadmin` page
3. Click "+ Add New Admin" button
4. Fill in the details for each user from the list above
5. Click "Create Admin"
6. Repeat for all 10 users

### Option 2: Using Script
1. Open terminal in the project root
2. Run: `bun run scripts/add-team-users.ts`
3. The script will create all users automatically

### Option 3: Direct Firebase Console
1. Go to Firebase Console > Authentication
2. Add users manually with emails and passwords
3. Then add user profiles in Firestore > users collection

---

## Important Notes

⚠️ **Default Password**: All users have the same initial password: `Welcome2024!`
- Users should change their password after first login
- Consider implementing forced password change on first login

🔐 **Security**:
- All users are assigned to Company ID: `COMP001`
- All users are set to `isActive: true`
- Roles determine access permissions throughout the system

📧 **Email Domain**: All emails use `@usinhomeservices.com`

📱 **Phone Numbers**:
- US-based users start with `+1`
- Philippines-based users start with `+63`
