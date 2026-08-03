/**
 * Data Sync Dashboard
 * Shows user-specific data synchronization status across all modules
 */

import { useAuth } from "@/lib/auth";
import { 
  getEmployeeFromEmail, 
  getUserTimecards, 
  getUserAttendance, 
  getUserPayslips,
  verifyDataIntegrity,
  clearAllUserData,
  initializeUserData,
} from "@/lib/userDataSync";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Database, User, Clock, Calendar, DollarSign } from "lucide-react";
import { useState, useEffect } from "react";

export function DataSyncDashboard() {
  const { email, ready } = useAuth();
  const [integrity, setIntegrity] = useState<ReturnType<typeof verifyDataIntegrity> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  
  const employee = getEmployeeFromEmail(email);
  const timecards = getUserTimecards(email);
  const attendance = getUserAttendance(email);
  const payslips = getUserPayslips(email);
  
  useEffect(() => {
    if (ready && email) {
      checkIntegrity();
    }
  }, [email, ready]);
  
  const checkIntegrity = () => {
    const result = verifyDataIntegrity(email);
    setIntegrity(result);
  };
  
  const handleRefresh = () => {
    setRefreshing(true);
    initializeUserData(email);
    setTimeout(() => {
      checkIntegrity();
      setRefreshing(false);
    }, 500);
  };
  
  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear ALL user data? This will reset data for all 10 employees.')) {
      clearAllUserData();
      alert('All user data cleared. Page will reload.');
      window.location.reload();
    }
  };
  
  if (!ready || !email) {
    return (
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
        <p className="text-slate-400">Please log in to view data sync status</p>
      </div>
    );
  }
  
  if (!employee) {
    return (
      <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-6">
        <div className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-red-400" />
          <p className="text-red-300">No employee record found for {email}</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Database className="h-6 w-6 text-blue-400" />
              Data Synchronization Dashboard
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              User-specific data across all modules
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold text-sm disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleClearAll}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-semibold text-sm"
            >
              Clear All Data
            </button>
          </div>
        </div>
      </div>
      
      {/* Employee Info */}
      <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="h-5 w-5 text-purple-400" />
          <h3 className="text-lg font-bold text-white">Current Employee</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Name</p>
            <p className="text-sm font-semibold text-white">{employee.name}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Email</p>
            <p className="text-sm text-slate-300">{employee.email}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Role</p>
            <p className="text-sm text-slate-300">{employee.role}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Department</p>
            <p className="text-sm text-slate-300">{employee.department}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Country</p>
            <p className="text-sm text-slate-300">{employee.country}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Hourly Rate</p>
            <p className="text-sm text-slate-300">{employee.country === "US" ? "$" : "₱"}{employee.hourlyRate}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Status</p>
            <p className="text-sm text-slate-300">{employee.status}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase mb-1">Hire Date</p>
            <p className="text-sm text-slate-300">{employee.hireDate}</p>
          </div>
        </div>
      </div>
      
      {/* Data Integrity Status */}
      {integrity && (
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="h-5 w-5 text-yellow-400" />
            <h3 className="text-lg font-bold text-white">Data Integrity Check</h3>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className={`p-4 rounded-lg border ${integrity.timecards ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
              <div className="flex items-center gap-2">
                {integrity.timecards ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <p className={`text-sm font-semibold ${integrity.timecards ? 'text-green-300' : 'text-red-300'}`}>
                  Timecards
                </p>
              </div>
            </div>
            
            <div className={`p-4 rounded-lg border ${integrity.attendance ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
              <div className="flex items-center gap-2">
                {integrity.attendance ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <p className={`text-sm font-semibold ${integrity.attendance ? 'text-green-300' : 'text-red-300'}`}>
                  Attendance
                </p>
              </div>
            </div>
            
            <div className={`p-4 rounded-lg border ${integrity.payslips ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
              <div className="flex items-center gap-2">
                {integrity.payslips ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <p className={`text-sm font-semibold ${integrity.payslips ? 'text-green-300' : 'text-red-300'}`}>
                  Payslips
                </p>
              </div>
            </div>
            
            <div className={`p-4 rounded-lg border ${integrity.profile ? 'bg-green-500/10 border-green-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
              <div className="flex items-center gap-2">
                {integrity.profile ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <p className={`text-sm font-semibold ${integrity.profile ? 'text-green-300' : 'text-red-300'}`}>
                  Profile
                </p>
              </div>
            </div>
          </div>
          
          {integrity.issues.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-lg p-4">
              <p className="text-xs font-semibold text-yellow-300 uppercase mb-2">Issues Found:</p>
              <ul className="space-y-1">
                {integrity.issues.map((issue, idx) => (
                  <li key={idx} className="text-xs text-yellow-200">• {issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      
      {/* Data Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Timecards */}
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <Clock className="h-5 w-5 text-blue-400" />
            <h3 className="text-lg font-bold text-white">Timecards</h3>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-slate-400 uppercase mb-1">Total Records</p>
              <p className="text-2xl font-bold text-blue-400">{timecards.length}</p>
            </div>
            {timecards.length > 0 && (
              <>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Latest Entry</p>
                  <p className="text-sm text-slate-300">{timecards[timecards.length - 1]?.date}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Status</p>
                  <p className="text-sm text-green-300">✓ Synced</p>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Attendance */}
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="h-5 w-5 text-green-400" />
            <h3 className="text-lg font-bold text-white">Attendance</h3>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-slate-400 uppercase mb-1">Total Records</p>
              <p className="text-2xl font-bold text-green-400">{attendance.length}</p>
            </div>
            {attendance.length > 0 && (
              <>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Present Days</p>
                  <p className="text-sm text-slate-300">
                    {attendance.filter((a: any) => a.status === 'present').length}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Status</p>
                  <p className="text-sm text-green-300">✓ Synced</p>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Payslips */}
        <div className="bg-slate-900/50 border border-white/10 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <DollarSign className="h-5 w-5 text-purple-400" />
            <h3 className="text-lg font-bold text-white">Payslips</h3>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-slate-400 uppercase mb-1">Total Records</p>
              <p className="text-2xl font-bold text-purple-400">{payslips.length}</p>
            </div>
            {payslips.length > 0 && (
              <>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Latest Period</p>
                  <p className="text-sm text-slate-300">
                    {payslips[payslips.length - 1]?.periodStart} to {payslips[payslips.length - 1]?.periodEnd}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Status</p>
                  <p className="text-sm text-green-300">✓ Synced</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Testing Instructions */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6">
        <h3 className="text-sm font-bold text-blue-300 mb-3">🧪 Testing Instructions</h3>
        <div className="space-y-2 text-xs text-blue-200">
          <p>1. Log in with different employee accounts (10 available)</p>
          <p>2. Check if each account has personalized data in all modules</p>
          <p>3. Verify data consistency between: Timecards → Payroll → Payslips</p>
          <p>4. Test announcements appear for each user after payroll processing</p>
          <p>5. Confirm Employee Self-Service shows correct user data</p>
        </div>
      </div>
    </div>
  );
}
