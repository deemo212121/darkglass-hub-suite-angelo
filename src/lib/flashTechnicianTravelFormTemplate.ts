export interface FlashTechnicianTravelFormData {
  employeeId: string;
  employeeName: string;
  employeeDateSigned: string;
  employeeSignatureDataUrl: string;
  employerDateSigned: string;
  employerSignatureDataUrl: string;
}

export interface FlashTechnicianTravelSignature {
  name: string;
  url: string;
  signedAt: string;
}
