/**
 * Script to add username field to existing users
 * Run this once to update all users who don't have a username yet
 */

import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { generateUsername } from "../src/lib/firebase/users";

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

const db = getFirestore();

async function updateUsernames() {
  console.log("🚀 Starting username update for existing users...\n");

  try {
    // Get all users
    const usersRef = collection(db, "users");
    const snapshot = await getDocs(usersRef);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const userDoc of snapshot.docs) {
      const userData = userDoc.data();
      const uid = userDoc.id;

      try {
        // Check if user already has username field
        if (userData.username) {
          console.log(`⏭️  Skipping ${userData.displayName} - already has username: ${userData.username}`);
          skippedCount++;
          continue;
        }

        // Generate username from displayName
        const username = generateUsername(userData.displayName || "");

        if (!username) {
          console.log(`❌ Skipping ${userData.email} - could not generate username from display name`);
          errorCount++;
          continue;
        }

        // Update user document
        const userRef = doc(db, "users", uid);
        await updateDoc(userRef, {
          username,
        });

        console.log(`✅ Updated ${userData.displayName} → Username: ${username}`);
        updatedCount++;
      } catch (error: any) {
        console.error(`❌ Error updating ${userData.displayName}:`, error.message);
        errorCount++;
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 Summary:");
    console.log(`   ✅ Updated: ${updatedCount} users`);
    console.log(`   ⏭️  Skipped (already had username): ${skippedCount} users`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📝 Total users: ${snapshot.size}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("💥 Script failed:", error);
    throw error;
  }
}

// Run the script
updateUsernames()
  .then(() => {
    console.log("\n✨ Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed:", error);
    process.exit(1);
  });
