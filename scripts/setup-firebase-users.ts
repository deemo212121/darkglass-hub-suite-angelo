/**
 * Firebase User Setup Script
 * 
 * This script creates all user accounts in Firebase Authentication
 * and their corresponding profiles in Firestore.
 * 
 * Run with: npx tsx scripts/setup-firebase-users.ts
 */

import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";

// Firebase config from .env
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// User accounts to create
const users = [
  // SuperAdmin accounts
  {
    email: "jdage7@gmail.com",
    password: "superadmin123",
    displayName: "JD Age",
    role: "SUPERADMIN",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "superadmin@ahsolutions.com",
    password: "superadmin123",
    displayName: "Super Admin",
    role: "SUPERADMIN",
    companyId: "COMP001",
    isActive: true,
  },
  
  // Admin accounts
  {
    email: "admin@ahsolutions.com",
    password: "admin123",
    displayName: "Admin User",
    role: "ADMIN",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "john.richardson@ahsolutions.com",
    password: "admin123",
    displayName: "John Richardson",
    role: "ADMIN",
    companyId: "COMP001",
    isActive: true,
  },
  
  // Manager
  {
    email: "manager@ahsolutions.com",
    password: "manager123",
    displayName: "Manager User",
    role: "MANAGER",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "sarah.mitchell@ahsolutions.com",
    password: "manager123",
    displayName: "Sarah Mitchell",
    role: "MANAGER",
    companyId: "COMP001",
    isActive: true,
  },
  
  // Technicians
  {
    email: "tech@ahsolutions.com",
    password: "tech123",
    displayName: "Tech User",
    role: "TECHNICIAN",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "michael.chen@ahsolutions.com",
    password: "tech123",
    displayName: "Michael Chen",
    role: "TECHNICIAN",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "emily.watson@ahsolutions.com",
    password: "tech123",
    displayName: "Emily Watson",
    role: "TECHNICIAN",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "juan.delacruz@ahsolutions.com.ph",
    password: "tech123",
    displayName: "Juan Dela Cruz",
    role: "TECHNICIAN",
    companyId: "COMP001",
    isActive: true,
  },
  
  // CSR
  {
    email: "csr@ahsolutions.com",
    password: "csr123",
    displayName: "CSR User",
    role: "CSR",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "david.rodriguez@ahsolutions.com",
    password: "csr123",
    displayName: "David Rodriguez",
    role: "CSR",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "carlos.gutierrez@ahsolutions.com.ph",
    password: "csr123",
    displayName: "Carlos Gutierrez",
    role: "CSR",
    companyId: "COMP001",
    isActive: true,
  },
  
  // HR
  {
    email: "hr@ahsolutions.com",
    password: "hr123",
    displayName: "HR User",
    role: "HR",
    companyId: "COMP001",
    isActive: true,
  },
  
  // Parts
  {
    email: "parts@ahsolutions.com",
    password: "parts123",
    displayName: "Parts User",
    role: "PARTS",
    companyId: "COMP001",
    isActive: true,
  },
  
  // Finance
  {
    email: "finance@ahsolutions.com",
    password: "finance123",
    displayName: "Finance User",
    role: "FINANCE",
    companyId: "COMP001",
    isActive: true,
  },
  {
    email: "maria.santos@ahsolutions.com.ph",
    password: "finance123",
    displayName: "Maria Santos",
    role: "FINANCE",
    companyId: "COMP001",
    isActive: true,
  },
  
  // Accounting
  {
    email: "anna.reyes@ahsolutions.com.ph",
    password: "accounting123",
    displayName: "Anna Reyes",
    role: "ACCOUNTING",
    companyId: "COMP001",
    isActive: true,
  },
  
  // Operations
  {
    email: "rosa.morales@ahsolutions.com.ph",
    password: "operations123",
    displayName: "Rosa Morales",
    role: "OPERATIONS",
    companyId: "COMP001",
    isActive: true,
  },
  
  // Viewer
  {
    email: "viewer@ahsolutions.com",
    password: "viewer123",
    displayName: "Viewer User",
    role: "VIEWER",
    companyId: "COMP001",
    isActive: true,
  },
];

async function createUser(userData: typeof users[0]) {
  try {
    console.log(`Creating user: ${userData.email}...`);
    
    // Create user in Firebase Authentication
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      userData.email,
      userData.password
    );
    
    const uid = userCredential.user.uid;
    console.log(`✅ Auth user created with UID: ${uid}`);
    
    // Create user profile in Firestore
    await setDoc(doc(db, "users", uid), {
      uid,
      email: userData.email,
      displayName: userData.displayName,
      role: userData.role,
      companyId: userData.companyId,
      isActive: userData.isActive,
      supabaseUserId: "", // Will be filled when Supabase is integrated
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    });
    
    console.log(`✅ Firestore profile created for ${userData.email}`);
    console.log("");
    
    return { success: true, email: userData.email, uid };
  } catch (error: any) {
    if (error.code === "auth/email-already-in-use") {
      console.log(`⚠️  User ${userData.email} already exists, skipping...`);
      console.log("");
      return { success: false, email: userData.email, error: "already-exists" };
    }
    
    console.error(`❌ Error creating ${userData.email}:`, error.message);
    console.log("");
    return { success: false, email: userData.email, error: error.message };
  }
}

async function setupAllUsers() {
  console.log("🔥 Firebase User Setup");
  console.log("=====================");
  console.log(`Creating ${users.length} user accounts...\n`);
  
  const results = [];
  
  for (const userData of users) {
    const result = await createUser(userData);
    results.push(result);
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  console.log("\n📊 Summary");
  console.log("==========");
  const successful = results.filter(r => r.success).length;
  const alreadyExists = results.filter(r => r.error === "already-exists").length;
  const failed = results.filter(r => r.success === false && r.error !== "already-exists").length;
  
  console.log(`✅ Successfully created: ${successful}`);
  console.log(`⚠️  Already existed: ${alreadyExists}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`\nTotal: ${results.length} users processed`);
  
  if (failed > 0) {
    console.log("\n❌ Failed users:");
    results
      .filter(r => r.success === false && r.error !== "already-exists")
      .forEach(r => console.log(`  - ${r.email}: ${r.error}`));
  }
  
  console.log("\n✅ Setup complete!");
  process.exit(0);
}

// Run the setup
setupAllUsers().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
