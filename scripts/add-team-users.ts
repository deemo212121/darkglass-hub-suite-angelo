/**
 * Script to add team user accounts to Firebase
 * 
 * Users to add:
 * 1. Aleena Hii
 * 2. Lou Basco
 * 3. Jerich Leonard
 * 4. Daven Hodge
 * 5. Jonathon Allen
 * 6. Justin Parker
 * 7. Raul Bayuyos Jr
 * 8. Naveen Lakhani
 * 9. Krista Griffiss
 * 10. Ian Montesclaros
 */

import { initializeApp, getApps } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";

// Firebase configuration from .env
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
if (getApps().length === 0) {
  initializeApp(firebaseConfig);
}

const auth = getAuth();
const db = getFirestore();

// User accounts to create
const teamUsers = [
  {
    email: "aleena.hii@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Aleena Hii",
    companyId: "COMP001",
    role: "CSR",
    phoneNumber: "+63 9123456701",
    department: "Customer Service",
    employeeId: "EMP-CSR-001",
  },
  {
    email: "lou.basco@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Lou Basco",
    companyId: "COMP001",
    role: "TECHNICIAN",
    phoneNumber: "+63 9123456702",
    department: "Field Operations",
    employeeId: "EMP-TECH-001",
  },
  {
    email: "jerich.leonard@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Jerich Leonard",
    companyId: "COMP001",
    role: "TECHNICIAN",
    phoneNumber: "+63 9123456703",
    department: "Field Operations",
    employeeId: "EMP-TECH-002",
  },
  {
    email: "daven.hodge@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Daven Hodge",
    companyId: "COMP001",
    role: "TECHNICIAN",
    phoneNumber: "+1 9045551001",
    department: "Field Operations",
    employeeId: "EMP-TECH-003",
  },
  {
    email: "jonathon.allen@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Jonathon Allen",
    companyId: "COMP001",
    role: "TECHNICIAN",
    phoneNumber: "+1 2515551002",
    department: "Field Operations",
    employeeId: "EMP-TECH-004",
  },
  {
    email: "justin.parker@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Justin Parker",
    companyId: "COMP001",
    role: "TECHNICIAN",
    phoneNumber: "+1 6155551003",
    department: "Field Operations",
    employeeId: "EMP-TECH-005",
  },
  {
    email: "raul.bayuyos@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Raul Bayuyos Jr",
    companyId: "COMP001",
    role: "TECHNICIAN",
    phoneNumber: "+63 9123456704",
    department: "Field Operations",
    employeeId: "EMP-TECH-006",
  },
  {
    email: "naveen.lakhani@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Naveen Lakhani",
    companyId: "COMP001",
    role: "MANAGER",
    phoneNumber: "+1 9015551004",
    department: "Operations Management",
    employeeId: "EMP-MGR-001",
  },
  {
    email: "krista.griffiss@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Krista Griffiss",
    companyId: "COMP001",
    role: "HR",
    phoneNumber: "+1 9015551005",
    department: "Human Resources",
    employeeId: "EMP-HR-001",
  },
  {
    email: "ian.montesclaros@usinhomeservices.com",
    password: "Welcome2024!",
    displayName: "Ian Montesclaros",
    companyId: "COMP001",
    role: "PARTS",
    phoneNumber: "+63 9123456705",
    department: "Parts Management",
    employeeId: "EMP-PARTS-001",
  },
];

async function createTeamUsers() {
  console.log("🚀 Starting Firebase team user creation...\n");

  // Get the SUPERADMIN UID to use as creator
  // In production, you'd get this from auth.currentUser
  const creatorUid = "SUPERADMIN_UID"; // Replace with actual superadmin UID

  let successCount = 0;
  let errorCount = 0;

  for (const userData of teamUsers) {
    try {
      console.log(`Creating user: ${userData.displayName} (${userData.email})...`);

      // 1. Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        userData.email,
        userData.password
      );
      const uid = userCredential.user.uid;

      // 2. Create Firestore user profile
      const userRef = doc(db, "users", uid);
      await setDoc(userRef, {
        uid,
        email: userData.email,
        displayName: userData.displayName,
        companyId: userData.companyId,
        role: userData.role,
        isActive: true,
        phoneNumber: userData.phoneNumber,
        employeeId: userData.employeeId,
        department: userData.department,
        permissions: [],
        createdAt: serverTimestamp(),
        createdBy: creatorUid,
        updatedAt: serverTimestamp(),
      });

      console.log(`✅ Successfully created: ${userData.displayName}`);
      console.log(`   UID: ${uid}`);
      console.log(`   Role: ${userData.role}`);
      console.log(`   Employee ID: ${userData.employeeId}\n`);

      successCount++;
    } catch (error: any) {
      errorCount++;
      console.error(`❌ Error creating ${userData.displayName}:`, error.message);

      if (error.code === "auth/email-already-in-use") {
        console.log(`   ℹ️  User already exists, skipping...\n`);
      } else {
        console.log(`   Error code: ${error.code}\n`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary:");
  console.log(`   ✅ Successfully created: ${successCount} users`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log("=".repeat(60));
  console.log("\n🔐 Default password for all users: Welcome2024!");
  console.log("⚠️  Users should change their password on first login.\n");
}

// Run the script
createTeamUsers()
  .then(() => {
    console.log("✨ Script completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });
