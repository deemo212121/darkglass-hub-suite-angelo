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
   * signature, date) — see FLASH_TRAVEL_CURRENT_VERSION.
   */
  templateVersion?: number;
}

export interface FlashTechnicianTravelSignature {
  name: string;
  url: string;
  signedAt: string;
}
