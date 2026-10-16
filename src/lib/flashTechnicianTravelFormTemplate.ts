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
  /**
   * Version 2 only: which wording the technician signed. Missing = the first
   * v2 text (ineligible items were deducted from the receipt); 2 = the Oct 13
   * 2026 text ("Ineligible Purchases and Reimbursement Limitations" — the
   * whole receipt's claim is denied). Regenerate PDF only rebuilds an
   * agreement signed under the current wording (FLASH_V2_WORDING_REVISION),
   * so a signature never ends up under text the person didn't see.
   */
  wordingRevision?: number;
}

export interface FlashTechnicianTravelSignature {
  name: string;
  url: string;
  signedAt: string;
}
