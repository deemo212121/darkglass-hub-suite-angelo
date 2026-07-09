# Employee Management Addition for HR Dashboard

The employee management section needs to be added to `src/components/ReportHRDaily.tsx` after the Job Interviews section.

## Required Changes:

### 1. Add Employee State Variables (after interview state):

```typescript
  // Employee management state
  const [employees, setEmployees] = useState<Employee[]>([
    { id: "1", name: "John Richardson", email: "john.r@ahsolutions.com", position: "Admin", branch: "Atlanta", country: "US", birthday: "1985-03-15", address: "123 Peachtree St, Atlanta, GA 30308", ssn: "***-**-1234", startDate: "2023-01-15", status: "Active", warningCount: 0 },
    { id: "2", name: "Sarah Mitchell", email: "sarah.m@ahsolutions.com", position: "Manager", branch: "Nashville", country: "US", birthday: "1990-07-22", address: "456 Music Row, Nashville, TN 37203", ssn: "***-**-5678", startDate: "2022-06-20", status: "Active", warningCount: 1 },
    { id: "3", name: "Michael Chen", email: "michael.c@ahsolutions.com", position: "Technician", branch: "Memphis", country: "US", birthday: "1988-11-03", address: "789 Beale St, Memphis, TN 38103", ssn: "***-**-9012", startDate: "2021-11-03", status: "Active", warningCount: 0 },
    { id: "4", name: "Emily Watson", email: "emily.w@ahsolutions.com", position: "CSR", branch: "Birmingham", country: "US", birthday: "1995-02-10", address: "321 Highland Ave, Birmingham, AL 35205", ssn: "***-**-3456", startDate: "2024-02-10", status: "Active", warningCount: 2 },
    { id: "5", name: "Maria Santos", email: "maria.s@ahsolutions.com", position: "CSR", branch: "Philippines", country: "PH", birthday: "1992-05-18", address: "Quezon City, Metro Manila, Philippines", startDate: "2022-03-01", status: "Active", warningCount: 0 },
    { id: "6", name: "David Rodriguez", email: "david.r@ahsolutions.com", position: "Technician", branch: "Dallas", country: "US", birthday: "1987-09-25", address: "567 Commerce St, Dallas, TX 75202", ssn: "***-**-7890", startDate: "2020-05-15", terminationDate: "2024-04-20", terminationReason: "Resignation", status: "Resigned", warningCount: 1 },
  ]);
  
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState<string>("");
  const [employeeBranchFilter, setEmployeeBranchFilter] = useState<string>("");
  const [employeeSortBy, setEmployeeSortBy] = useState<"name" | "startDate" | "warnings">("name");
  const [employeeSortOrder, setEmployeeSortOrder] = useState<"asc" | "desc">("asc");
  
  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({
    name: "",
    email: "",
    position: "",
    branch: "",
    country: "US",
    birthday: "",
    address: "",
    ssn: "",
    startDate: "",
    status: "Active",
    warningCount: 0,
  });
```

### 2. Add Filtered Employees Logic (after todaysInterviews):

```typescript
  // Filtered and sorted employees
  const filteredEmployees = useMemo(() => {
    let result = [...employees];
    
    // Apply status filter
    if (employeeStatusFilter) {
      result = result.filter(e => e.status === employeeStatusFilter);
    }
    
    // Apply branch filter
    if (employeeBranchFilter) {
      result = result.filter(e => e.branch === employeeBranchFilter);
    }
    
    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      
      switch (employeeSortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "startDate":
          comparison = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
          break;
        case "warnings":
          comparison = a.warningCount - b.warningCount;
          break;
      }
      
      return employeeSortOrder === "asc" ? comparison : -comparison;
    });
    
    return result;
  }, [employees, employeeStatusFilter, employeeBranchFilter, employeeSortBy, employeeSortOrder]);
```

### 3. Add Employee Handler Functions (after handleDeleteCandidate):

```typescript
  const handleAddEmployee = () => {
    if (newEmployee.name && newEmployee.email && newEmployee.position && newEmployee.branch && newEmployee.startDate) {
      setEmployees([...employees, {
        id: Date.now().toString(),
        name: newEmployee.name || "",
        email: newEmployee.email || "",
        position: newEmployee.position || "",
        branch: newEmployee.branch || "",
        country: newEmployee.country || "US",
        birthday: newEmployee.birthday || "",
        address: newEmployee.address || "",
        ssn: newEmployee.country === "US" ? newEmployee.ssn : undefined,
        startDate: newEmployee.startDate || "",
        status: "Active",
        warningCount: 0,
      }]);
      setNewEmployee({ name: "", email: "", position: "", branch: "", country: "US", birthday: "", address: "", ssn: "", startDate: "", status: "Active", warningCount: 0 });
      setShowAddEmployee(false);
    }
  };

  const handleUpdateEmployeeStatus = (id: string, newStatus: Employee["status"]) => {
    setEmployees(employees.map(e => e.id === id ? { ...e, status: newStatus } : e));
  };

  const handleDeleteEmployee = (id: string) => {
    setEmployees(employees.filter(e => e.id !== id));
  };

  const handleHireCandidate = (candidate: InterviewCandidate) => {
    // Create new employee from candidate
    const newEmp: Employee = {
      id: Date.now().toString(),
      name: candidate.name,
      email: `${candidate.name.toLowerCase().replace(/\s+/g, '.')}@ahsolutions.com`,
      position: candidate.position,
      branch: candidate.branch,
      country: "US", // Default, can be changed
      birthday: "",
      address: "",
      startDate: new Date().toISOString().slice(0, 10),
      status: "Active",
      warningCount: 0,
    };
    setEmployees([...employees, newEmp]);
    handleUpdateStatus(candidate.id, "hired");
  };
```

### 4. Update Interview Table Actions Column to include "Create Account" button:

Change the actions <td> to include the button when status is "completed".

### 5. Add complete Employee Management Section after Job Interviews section with properly labeled date pickers.

The form should have labels for:
- Full Name *
- Email *  
- Position *
- Branch *
- Country *
- **Birthday** (label to clarify date picker)
- **Start Date *** (label to clarify date picker)
- SSN (US Only)
- Address
