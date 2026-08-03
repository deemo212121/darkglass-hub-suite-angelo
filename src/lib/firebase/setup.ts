/**
 * Firebase Setup Utilities
 * 
 * This file contains helper functions for initial Firebase setup
 * Run these functions from the browser console or a setup page
 */

import { createCompany, createUserAccount, UserRole } from "./users";

/**
 * Initial setup data
 */
export const INITIAL_SETUP = {
  // First company
  company: {
    companyName: "AH Solutions",
    address: "123 Main Street",
    city: "New York",
    state: "NY",
    zipCode: "10001",
    phoneNumber: "(555) 123-4567",
    email: "info@ahsolutions.com",
    isActive: true,
    subscriptionPlan: "enterprise" as const,
  },

  // First superadmin user
  superadmin: {
    email: "superadmin@ahsolutions.com",
    password: "Admin123!@#",  // CHANGE THIS IN PRODUCTION!
    displayName: "Super Administrator",
    role: "SUPERADMIN" as UserRole,
    phoneNumber: "(555) 100-0001",
    employeeId: "SA001",
    department: "Administration",
  },

  // Sample admin user
  admin: {
    email: "admin@ahsolutions.com",
    password: "Admin123!",  // CHANGE THIS IN PRODUCTION!
    displayName: "Company Admin",
    role: "ADMIN" as UserRole,
    phoneNumber: "(555) 100-0002",
    employeeId: "ADM001",
    department: "Administration",
  },

  // Sample manager user
  manager: {
    email: "manager@ahsolutions.com",
    password: "Manager123!",  // CHANGE THIS IN PRODUCTION!
    displayName: "Operations Manager",
    role: "MANAGER" as UserRole,
    phoneNumber: "(555) 100-0003",
    employeeId: "MGR001",
    department: "Operations",
  },

  // Sample technician
  technician: {
    email: "tech@ahsolutions.com",
    password: "Tech123!",  // CHANGE THIS IN PRODUCTION!
    displayName: "John Technician",
    role: "TECHNICIAN" as UserRole,
    phoneNumber: "(555) 100-0004",
    employeeId: "TECH001",
    department: "Field Services",
  },

  // Sample CSR
  csr: {
    email: "csr@ahsolutions.com",
    password: "CSR123!",  // CHANGE THIS IN PRODUCTION!
    displayName: "Sarah Customer Service",
    role: "CSR" as UserRole,
    phoneNumber: "(555) 100-0005",
    employeeId: "CSR001",
    department: "Customer Service",
  },
};

/**
 * Setup the initial company and superadmin
 * This should be run ONCE during initial setup
 */
export async function setupInitialData(): Promise<{
  companyId: string;
  superadminUid: string;
}> {
  console.log("🚀 Starting initial Firebase setup...");

  try {
    // Step 1: Create the company
    console.log("📦 Creating company...");
    const companyId = await createCompany(
      INITIAL_SETUP.company,
      "system" // Creator is "system" for initial setup
    );
    console.log(`✅ Company created: ${companyId}`);

    // Step 2: Create superadmin user
    console.log("👤 Creating superadmin user...");
    const superadminUid = await createUserAccount(
      {
        ...INITIAL_SETUP.superadmin,
        companyId,
      },
      "system" // Creator is "system" for initial setup
    );
    console.log(`✅ Superadmin created: ${superadminUid}`);

    console.log("\n🎉 Initial setup complete!");
    console.log("\n📝 Login credentials:");
    console.log(`   Email: ${INITIAL_SETUP.superadmin.email}`);
    console.log(`   Password: ${INITIAL_SETUP.superadmin.password}`);
    console.log("\n⚠️  IMPORTANT: Change the default password immediately!");

    return { companyId, superadminUid };
  } catch (error: any) {
    console.error("❌ Setup failed:", error.message);
    throw error;
  }
}

/**
 * Create sample users for testing
 * This creates admin, manager, technician, and CSR accounts
 */
export async function createSampleUsers(
  companyId: string,
  creatorUid: string
): Promise<{
  adminUid: string;
  managerUid: string;
  technicianUid: string;
  csrUid: string;
}> {
  console.log("🚀 Creating sample users...");

  try {
    // Create admin
    console.log("👤 Creating admin user...");
    const adminUid = await createUserAccount(
      {
        ...INITIAL_SETUP.admin,
        companyId,
      },
      creatorUid
    );
    console.log(`✅ Admin created: ${adminUid}`);

    // Create manager
    console.log("👤 Creating manager user...");
    const managerUid = await createUserAccount(
      {
        ...INITIAL_SETUP.manager,
        companyId,
      },
      creatorUid
    );
    console.log(`✅ Manager created: ${managerUid}`);

    // Create technician
    console.log("👤 Creating technician user...");
    const technicianUid = await createUserAccount(
      {
        ...INITIAL_SETUP.technician,
        companyId,
      },
      creatorUid
    );
    console.log(`✅ Technician created: ${technicianUid}`);

    // Create CSR
    console.log("👤 Creating CSR user...");
    const csrUid = await createUserAccount(
      {
        ...INITIAL_SETUP.csr,
        companyId,
      },
      creatorUid
    );
    console.log(`✅ CSR created: ${csrUid}`);

    console.log("\n🎉 Sample users created!");
    console.log("\n📝 Test accounts:");
    console.log(`   Admin: ${INITIAL_SETUP.admin.email} / ${INITIAL_SETUP.admin.password}`);
    console.log(`   Manager: ${INITIAL_SETUP.manager.email} / ${INITIAL_SETUP.manager.password}`);
    console.log(`   Technician: ${INITIAL_SETUP.technician.email} / ${INITIAL_SETUP.technician.password}`);
    console.log(`   CSR: ${INITIAL_SETUP.csr.email} / ${INITIAL_SETUP.csr.password}`);
    console.log("\n⚠️  IMPORTANT: These are test accounts - change passwords in production!");

    return { adminUid, managerUid, technicianUid, csrUid };
  } catch (error: any) {
    console.error("❌ Sample user creation failed:", error.message);
    throw error;
  }
}

/**
 * Complete setup wizard
 * Creates company, superadmin, and sample users all at once
 */
export async function runCompleteSetup(): Promise<void> {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   FIREBASE SETUP WIZARD                        ║");
  console.log("╚════════════════════════════════════════════════╝");
  console.log("");

  try {
    // Step 1: Initial setup (company + superadmin)
    const { companyId, superadminUid } = await setupInitialData();

    console.log("\n⏳ Waiting 2 seconds before creating sample users...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 2: Create sample users
    await createSampleUsers(companyId, superadminUid);

    console.log("\n╔════════════════════════════════════════════════╗");
    console.log("║   SETUP COMPLETE! 🎉                           ║");
    console.log("╚════════════════════════════════════════════════╝");
    console.log("");
    console.log("Next steps:");
    console.log("1. Login as superadmin");
    console.log("2. Go to /admin/users");
    console.log("3. Change all default passwords");
    console.log("4. Create your real users");
    console.log("5. Delete test accounts if not needed");
    console.log("");
  } catch (error: any) {
    console.error("\n❌ SETUP FAILED:", error.message);
    console.error("\nPlease fix the error and try again.");
    throw error;
  }
}

/**
 * Create a second company for testing multi-company features
 */
export async function createTestCompany(
  creatorUid: string
): Promise<{ companyId: string; adminUid: string }> {
  console.log("🚀 Creating test company...");

  try {
    // Create second company
    const companyId = await createCompany(
      {
        companyName: "Test Company Inc.",
        address: "456 Test Avenue",
        city: "Los Angeles",
        state: "CA",
        zipCode: "90001",
        phoneNumber: "(555) 999-0001",
        email: "info@testcompany.com",
        isActive: true,
        subscriptionPlan: "professional" as const,
      },
      creatorUid
    );
    console.log(`✅ Test company created: ${companyId}`);

    // Create admin for test company
    const adminUid = await createUserAccount(
      {
        email: "admin@testcompany.com",
        password: "TestAdmin123!",
        displayName: "Test Company Admin",
        companyId,
        role: "ADMIN" as UserRole,
        phoneNumber: "(555) 999-0002",
        employeeId: "TADM001",
        department: "Administration",
      },
      creatorUid
    );
    console.log(`✅ Test company admin created: ${adminUid}`);

    console.log("\n📝 Test company login:");
    console.log(`   Email: admin@testcompany.com`);
    console.log(`   Password: TestAdmin123!`);

    return { companyId, adminUid };
  } catch (error: any) {
    console.error("❌ Test company creation failed:", error.message);
    throw error;
  }
}

/**
 * Check if initial setup has been completed
 */
export async function isSetupComplete(): Promise<boolean> {
  try {
    const { getAllUsers } = await import("./users");
    const users = await getAllUsers();
    return users.length > 0;
  } catch {
    return false;
  }
}

// Export for browser console usage
if (typeof window !== "undefined") {
  (window as any).firebaseSetup = {
    runCompleteSetup,
    setupInitialData,
    createSampleUsers,
    createTestCompany,
    isSetupComplete,
  };

  console.log("🔧 Firebase setup utilities loaded!");
  console.log("   Run: firebaseSetup.runCompleteSetup()");
  console.log("   to create initial company and users");
}
