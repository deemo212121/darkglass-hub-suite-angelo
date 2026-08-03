import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  UserPlus,
  Building2,
  Shield,
  Edit,
  Trash2,
  UserCheck,
  UserX,
  Search,
} from "lucide-react";
import {
  createUserAccount,
  getUserAccount,
  getCompanyUsers,
  getAllUsers,
  updateUserAccount,
  deactivateUserAccount,
  activateUserAccount,
  createCompany,
  getCompany,
  getAllCompanies,
  updateCompany,
  UserAccount,
  Company,
  UserRole,
} from "@/lib/firebase/users";
import { getCurrentUser } from "@/lib/firebase/auth";

export default function UserManagementPage() {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [showCompanyDialog, setShowCompanyDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  // Form states
  const [userForm, setUserForm] = useState({
    email: "",
    password: "",
    displayName: "",
    companyId: "",
    role: "TECHNICIAN" as UserRole,
    phoneNumber: "",
    employeeId: "",
    department: "",
  });

  const [companyForm, setCompanyForm] = useState({
    companyName: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
    phoneNumber: "",
    email: "",
    isActive: true,
    subscriptionPlan: "professional" as "basic" | "professional" | "enterprise",
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const authUser = getCurrentUser();
      if (!authUser) {
        toast.error("Not authenticated");
        return;
      }

      const userData = await getUserAccount(authUser.uid);
      setCurrentUser(userData);

      if (userData?.role === "SUPERADMIN") {
        const [allUsers, allCompanies] = await Promise.all([
          getAllUsers(),
          getAllCompanies(),
        ]);
        setUsers(allUsers);
        setCompanies(allCompanies);
      } else if (userData?.role === "ADMIN") {
        const [companyUsers, companyData] = await Promise.all([
          getCompanyUsers(userData.companyId),
          getCompany(userData.companyId),
        ]);
        setUsers(companyUsers);
        setCompanies(companyData ? [companyData] : []);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    try {
      if (!currentUser) {
        toast.error("Not authenticated");
        return;
      }

      if (!userForm.email || !userForm.password || !userForm.displayName || !userForm.companyId) {
        toast.error("Please fill in all required fields");
        return;
      }

      await createUserAccount(
        {
          email: userForm.email,
          password: userForm.password,
          displayName: userForm.displayName,
          companyId: userForm.companyId,
          role: userForm.role,
          phoneNumber: userForm.phoneNumber,
          employeeId: userForm.employeeId,
          department: userForm.department,
        },
        currentUser.uid
      );

      toast.success("User created successfully");
      setShowUserDialog(false);
      resetUserForm();
      loadData();
    } catch (error: any) {
      console.error("Error creating user:", error);
      toast.error(error.message || "Failed to create user");
    }
  };

  const handleUpdateUser = async () => {
    try {
      if (!editingUser) return;

      await updateUserAccount(editingUser.uid, {
        displayName: userForm.displayName,
        role: userForm.role,
        phoneNumber: userForm.phoneNumber,
        employeeId: userForm.employeeId,
        department: userForm.department,
        companyId: userForm.companyId,
      });

      toast.success("User updated successfully");
      setShowUserDialog(false);
      setEditingUser(null);
      resetUserForm();
      loadData();
    } catch (error: any) {
      console.error("Error updating user:", error);
      toast.error(error.message || "Failed to update user");
    }
  };

  const handleToggleUserStatus = async (user: UserAccount) => {
    try {
      if (user.isActive) {
        await deactivateUserAccount(user.uid);
        toast.success("User deactivated");
      } else {
        await activateUserAccount(user.uid);
        toast.success("User activated");
      }
      loadData();
    } catch (error) {
      console.error("Error toggling user status:", error);
      toast.error("Failed to update user status");
    }
  };

  const handleCreateCompany = async () => {
    try {
      if (!currentUser) {
        toast.error("Not authenticated");
        return;
      }

      if (!companyForm.companyName || !companyForm.email) {
        toast.error("Please fill in required fields");
        return;
      }

      await createCompany(companyForm, currentUser.uid);

      toast.success("Company created successfully");
      setShowCompanyDialog(false);
      resetCompanyForm();
      loadData();
    } catch (error) {
      console.error("Error creating company:", error);
      toast.error("Failed to create company");
    }
  };

  const handleUpdateCompany = async () => {
    try {
      if (!editingCompany) return;

      await updateCompany(editingCompany.companyId, companyForm);

      toast.success("Company updated successfully");
      setShowCompanyDialog(false);
      setEditingCompany(null);
      resetCompanyForm();
      loadData();
    } catch (error) {
      console.error("Error updating company:", error);
      toast.error("Failed to update company");
    }
  };

  const openEditUserDialog = (user: UserAccount) => {
    setEditingUser(user);
    setUserForm({
      email: user.email,
      password: "",
      displayName: user.displayName,
      companyId: user.companyId,
      role: user.role,
      phoneNumber: user.phoneNumber || "",
      employeeId: user.employeeId || "",
      department: user.department || "",
    });
    setShowUserDialog(true);
  };

  const openEditCompanyDialog = (company: Company) => {
    setEditingCompany(company);
    setCompanyForm({
      companyName: company.companyName,
      address: company.address,
      city: company.city,
      state: company.state,
      zipCode: company.zipCode,
      phoneNumber: company.phoneNumber,
      email: company.email,
      isActive: company.isActive,
      subscriptionPlan: company.subscriptionPlan || "professional",
    });
    setShowCompanyDialog(true);
  };

  const resetUserForm = () => {
    setUserForm({
      email: "",
      password: "",
      displayName: "",
      companyId: "",
      role: "TECHNICIAN",
      phoneNumber: "",
      employeeId: "",
      department: "",
    });
  };

  const resetCompanyForm = () => {
    setCompanyForm({
      companyName: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      phoneNumber: "",
      email: "",
      isActive: true,
      subscriptionPlan: "professional",
    });
  };

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.employeeId?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCompany =
      selectedCompany === "all" || user.companyId === selectedCompany;

    return matchesSearch && matchesCompany;
  });

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case "SUPERADMIN":
        return "bg-red-500";
      case "ADMIN":
        return "bg-orange-500";
      case "MANAGER":
        return "bg-blue-500";
      case "CSR":
        return "bg-green-500";
      case "TECHNICIAN":
        return "bg-purple-500";
      default:
        return "bg-gray-500";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const isSuperAdmin = currentUser?.role === "SUPERADMIN";
  const isAdmin = currentUser?.role === "ADMIN" || isSuperAdmin;

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Shield className="h-16 w-16 mx-auto text-red-500 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <p className="text-muted-foreground">
            Manage users and companies in the system
          </p>
        </div>
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button
              onClick={() => {
                setEditingCompany(null);
                resetCompanyForm();
                setShowCompanyDialog(true);
              }}
            >
              <Building2 className="h-4 w-4 mr-2" />
              Add Company
            </Button>
          )}
          <Button
            onClick={() => {
              setEditingUser(null);
              resetUserForm();
              setShowUserDialog(true);
            }}
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        {companies.length > 1 && (
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companies.map((company) => (
                <SelectItem key={company.companyId} value={company.companyId}>
                  {company.companyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Users Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Employee ID</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.uid}>
                  <TableCell className="font-medium">
                    {user.displayName}
                    {user.email.includes("gmail.com") && (
                      <span className="ml-2 text-xs text-blue-500" title="Can sign in with Google">
                        🔗 Google
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {companies.find((c) => c.companyId === user.companyId)
                      ?.companyName || user.companyId}
                  </TableCell>
                  <TableCell>
                    <Badge className={getRoleBadgeColor(user.role)}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? "default" : "secondary"}>
                      {user.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>{user.employeeId || "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditUserDialog(user)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant={user.isActive ? "outline" : "default"}
                        onClick={() => handleToggleUserStatus(user)}
                      >
                        {user.isActive ? (
                          <UserX className="h-4 w-4" />
                        ) : (
                          <UserCheck className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Companies Section (SuperAdmin only) */}
      {isSuperAdmin && companies.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Companies</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {companies.map((company) => (
              <div
                key={company.companyId}
                className="border rounded-lg p-4 space-y-2"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold">{company.companyName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {company.companyId}
                    </p>
                  </div>
                  <Badge variant={company.isActive ? "default" : "secondary"}>
                    {company.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="text-sm space-y-1">
                  <p>{company.address}</p>
                  <p>
                    {company.city}, {company.state} {company.zipCode}
                  </p>
                  <p>{company.phoneNumber}</p>
                  <p className="text-muted-foreground">{company.email}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => openEditCompanyDialog(company)}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Company
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User Dialog */}
      <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingUser ? "Edit User" : "Create New User"}
            </DialogTitle>
            <DialogDescription>
              {editingUser
                ? "Update user information"
                : "Add a new user to the system"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={userForm.email}
                onChange={(e) =>
                  setUserForm({ ...userForm, email: e.target.value })
                }
                disabled={!!editingUser}
              />
            </div>
            {!editingUser && (
              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={userForm.password}
                  onChange={(e) =>
                    setUserForm({ ...userForm, password: e.target.value })
                  }
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name *</Label>
              <Input
                id="displayName"
                value={userForm.displayName}
                onChange={(e) =>
                  setUserForm({ ...userForm, displayName: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company *</Label>
              <Select
                value={userForm.companyId}
                onValueChange={(value) =>
                  setUserForm({ ...userForm, companyId: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((company) => (
                    <SelectItem
                      key={company.companyId}
                      value={company.companyId}
                    >
                      {company.companyName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role *</Label>
              <Select
                value={userForm.role}
                onValueChange={(value) =>
                  setUserForm({ ...userForm, role: value as UserRole })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isSuperAdmin && (
                    <>
                      <SelectItem value="SUPERADMIN">Super Admin</SelectItem>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                    </>
                  )}
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="CSR">CSR</SelectItem>
                  <SelectItem value="TECHNICIAN">Technician</SelectItem>
                  <SelectItem value="DISPATCHER">Dispatcher</SelectItem>
                  <SelectItem value="HR">HR</SelectItem>
                  <SelectItem value="IT">IT</SelectItem>
                  <SelectItem value="PARTS">Parts</SelectItem>
                  <SelectItem value="FINANCE">Finance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                value={userForm.phoneNumber}
                onChange={(e) =>
                  setUserForm({ ...userForm, phoneNumber: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employeeId">Employee ID</Label>
              <Input
                id="employeeId"
                value={userForm.employeeId}
                onChange={(e) =>
                  setUserForm({ ...userForm, employeeId: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                value={userForm.department}
                onChange={(e) =>
                  setUserForm({ ...userForm, department: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={editingUser ? handleUpdateUser : handleCreateUser}
            >
              {editingUser ? "Update User" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Company Dialog */}
      <Dialog open={showCompanyDialog} onOpenChange={setShowCompanyDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCompany ? "Edit Company" : "Create New Company"}
            </DialogTitle>
            <DialogDescription>
              {editingCompany
                ? "Update company information"
                : "Add a new company to the system"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label htmlFor="companyName">Company Name *</Label>
              <Input
                id="companyName"
                value={companyForm.companyName}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    companyName: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={companyForm.address}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, address: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={companyForm.city}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, city: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={companyForm.state}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, state: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zipCode">Zip Code</Label>
              <Input
                id="zipCode"
                value={companyForm.zipCode}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, zipCode: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyPhone">Phone Number</Label>
              <Input
                id="companyPhone"
                value={companyForm.phoneNumber}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    phoneNumber: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="companyEmail">Email *</Label>
              <Input
                id="companyEmail"
                type="email"
                value={companyForm.email}
                onChange={(e) =>
                  setCompanyForm({ ...companyForm, email: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subscriptionPlan">Subscription Plan</Label>
              <Select
                value={companyForm.subscriptionPlan}
                onValueChange={(value) =>
                  setCompanyForm({
                    ...companyForm,
                    subscriptionPlan: value as any,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="professional">Professional</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCompanyDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={
                editingCompany ? handleUpdateCompany : handleCreateCompany
              }
            >
              {editingCompany ? "Update Company" : "Create Company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
