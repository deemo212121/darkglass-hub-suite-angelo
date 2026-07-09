import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Database,
  Shield,
  Building2,
  Users,
} from "lucide-react";
import {
  runCompleteSetup,
  isSetupComplete,
  INITIAL_SETUP,
} from "@/lib/firebase/setup";
import { isFirebaseReady } from "@/lib/firebase/config";

export default function FirebaseSetupPage() {
  const [setupStatus, setSetupStatus] = useState<
    "idle" | "checking" | "running" | "complete" | "error"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [isAlreadySetup, setIsAlreadySetup] = useState(false);
  const [firebaseConfigured, setFirebaseConfigured] = useState(false);

  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    setSetupStatus("checking");
    setMessage("Checking Firebase configuration...");

    // Check if Firebase is configured
    const configured = isFirebaseReady();
    setFirebaseConfigured(configured);

    if (!configured) {
      setSetupStatus("error");
      setMessage("Firebase is not configured. Please check your .env file.");
      return;
    }

    try {
      const complete = await isSetupComplete();
      setIsAlreadySetup(complete);
      
      if (complete) {
        setSetupStatus("complete");
        setMessage("Setup already completed. System is ready to use.");
      } else {
        setSetupStatus("idle");
        setMessage("Ready to run initial setup");
      }
    } catch (error) {
      console.error("Error checking setup:", error);
      setSetupStatus("idle");
      setMessage("Ready to run initial setup");
    }
  };

  const runSetup = async () => {
    if (!firebaseConfigured) {
      toast.error("Firebase is not configured. Please check your .env file.");
      return;
    }

    setSetupStatus("running");
    setProgress(0);
    setMessage("Starting Firebase setup...");

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 500);

      await runCompleteSetup();

      clearInterval(progressInterval);
      setProgress(100);
      setSetupStatus("complete");
      setMessage("Setup completed successfully!");
      toast.success("Firebase setup complete!");
    } catch (error: any) {
      console.error("Setup error:", error);
      setSetupStatus("error");
      setMessage(`Setup failed: ${error.message}`);
      toast.error("Setup failed. Check console for details.");
    }
  };

  const getStatusIcon = () => {
    switch (setupStatus) {
      case "checking":
        return <Loader2 className="h-8 w-8 animate-spin text-blue-500" />;
      case "running":
        return <Loader2 className="h-8 w-8 animate-spin text-blue-500" />;
      case "complete":
        return <CheckCircle className="h-8 w-8 text-green-500" />;
      case "error":
        return <XCircle className="h-8 w-8 text-red-500" />;
      default:
        return <Database className="h-8 w-8 text-gray-500" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            Firebase Setup Wizard
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Initialize your AH Solutions system with Firebase
          </p>
        </div>

        {/* Status Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              {getStatusIcon()}
              <div>
                <CardTitle>Setup Status</CardTitle>
                <CardDescription>{message}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {setupStatus === "running" && (
              <Progress value={progress} className="w-full" />
            )}

            {!firebaseConfigured && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Firebase Not Configured</strong>
                  <br />
                  Please add your Firebase credentials to the .env file:
                  <pre className="mt-2 text-xs bg-black/10 p-2 rounded">
                    VITE_FIREBASE_API_KEY=...
                    <br />
                    VITE_FIREBASE_AUTH_DOMAIN=...
                    <br />
                    VITE_FIREBASE_PROJECT_ID=...
                    <br />
                    VITE_FIREBASE_STORAGE_BUCKET=...
                    <br />
                    VITE_FIREBASE_MESSAGING_SENDER_ID=...
                    <br />
                    VITE_FIREBASE_APP_ID=...
                  </pre>
                </AlertDescription>
              </Alert>
            )}

            {firebaseConfigured && !isAlreadySetup && setupStatus === "idle" && (
              <Button
                size="lg"
                className="w-full"
                onClick={runSetup}
                disabled={setupStatus === "running"}
              >
                {setupStatus === "running" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Running Setup...
                  </>
                ) : (
                  <>
                    <Database className="mr-2 h-4 w-4" />
                    Run Initial Setup
                  </>
                )}
              </Button>
            )}

            {setupStatus === "complete" && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Setup Complete!</strong>
                  <br />
                  Your system is ready to use. You can now login with the
                  superadmin account.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* What Will Be Created */}
        <Card>
          <CardHeader>
            <CardTitle>What Will Be Created</CardTitle>
            <CardDescription>
              The setup wizard will create the following:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex gap-3 p-4 border rounded-lg">
                <Building2 className="h-6 w-6 text-blue-500 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold">Company</h3>
                  <p className="text-sm text-muted-foreground">
                    {INITIAL_SETUP.company.companyName}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Main company account with enterprise subscription
                  </p>
                </div>
              </div>

              <div className="flex gap-3 p-4 border rounded-lg">
                <Shield className="h-6 w-6 text-red-500 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold">SuperAdmin</h3>
                  <p className="text-sm text-muted-foreground">
                    {INITIAL_SETUP.superadmin.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Full system access, can manage all companies
                  </p>
                </div>
              </div>

              <div className="flex gap-3 p-4 border rounded-lg">
                <Users className="h-6 w-6 text-orange-500 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold">Admin User</h3>
                  <p className="text-sm text-muted-foreground">
                    {INITIAL_SETUP.admin.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Company admin with user management
                  </p>
                </div>
              </div>

              <div className="flex gap-3 p-4 border rounded-lg">
                <Users className="h-6 w-6 text-green-500 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold">Sample Users</h3>
                  <p className="text-sm text-muted-foreground">
                    Manager, Technician, CSR
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Test accounts for different roles
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Login Credentials */}
        {setupStatus === "complete" && (
          <Card className="border-green-500">
            <CardHeader>
              <CardTitle>Login Credentials</CardTitle>
              <CardDescription>
                Use these credentials to login to the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2 text-red-600">
                    SuperAdmin Account
                  </h4>
                  <div className="space-y-1 text-sm">
                    <p>
                      <strong>Email:</strong> {INITIAL_SETUP.superadmin.email}
                    </p>
                    <p>
                      <strong>Password:</strong> {INITIAL_SETUP.superadmin.password}
                    </p>
                  </div>
                </div>

                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2 text-orange-600">
                    Admin Account
                  </h4>
                  <div className="space-y-1 text-sm">
                    <p>
                      <strong>Email:</strong> {INITIAL_SETUP.admin.email}
                    </p>
                    <p>
                      <strong>Password:</strong> {INITIAL_SETUP.admin.password}
                    </p>
                  </div>
                </div>

                <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2">Test Accounts</h4>
                  <div className="space-y-1 text-sm">
                    <p>
                      <strong>Manager:</strong> {INITIAL_SETUP.manager.email} /{" "}
                      {INITIAL_SETUP.manager.password}
                    </p>
                    <p>
                      <strong>Technician:</strong> {INITIAL_SETUP.technician.email}{" "}
                      / {INITIAL_SETUP.technician.password}
                    </p>
                    <p>
                      <strong>CSR:</strong> {INITIAL_SETUP.csr.email} /{" "}
                      {INITIAL_SETUP.csr.password}
                    </p>
                  </div>
                </div>

                <Alert variant="destructive">
                  <Shield className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Security Warning:</strong> Change all default
                    passwords immediately after first login!
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Next Steps */}
        {setupStatus === "complete" && (
          <Card>
            <CardHeader>
              <CardTitle>Next Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Login with the superadmin credentials above</li>
                <li>Navigate to the User Management page (/admin/users)</li>
                <li>Change all default passwords</li>
                <li>Deploy Firestore and Storage security rules</li>
                <li>Create your real user accounts</li>
                <li>Delete test accounts if not needed</li>
                <li>Configure company settings</li>
              </ol>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
