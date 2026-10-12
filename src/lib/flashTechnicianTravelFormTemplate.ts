export interface FlashTechnicianTravelFormData {
  employeeId: string;
  employeeName: string;
  employeeDateSigned: string;
  employeeSignatureDataUrl: string;
  employerDateSigned: string;
  employerSignatureDataUrl: string;
  /**
   * Which document this is. Missing = 1, the "Flash Technician Travel &
   * Out-of-State Policy" (employee + employer signatures). 2 = the "Flash
   * Tech Travel & Expense Policy Agreement" (employee only: printed name,
   * Employee ID, signature, date) — see FLASH_TRAVEL_CURRENT_VERSION.
   */
  templateVersion?: number;
  /** Version 2's "Employee ID" line — the technician ID, pre-filled from the profile. */
  employeeIdNumber?: string;
}

export interface FlashTechnicianTravelSignature {
  name: string;
  url: string;
  signedAt: string;
}
