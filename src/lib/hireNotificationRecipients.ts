// Fixed extra recipients on every hire notification, regardless of branch —
// the user's explicit list (Naveen Lakhani, Yujung Chris Yong, Lou Basco).
// Not role-derived like Branch Manager/SBM since none of the three hold a
// BM/SBM role themselves. Shared by the Hiring tab (notifyOnCandidateHired)
// and a manager's Hire answer (src/lib/server/traineeDecisions.ts).
export const HIRE_NOTIFICATION_EXTRA_RECIPIENT_IDS = [
  "bec83133-0de3-4fa6-8174-f6aa1b04d3e8", // Naveen Lakhani
  "f4131c1f-0676-40e0-aa61-dc10ca620259", // Yujung Chris Yong
  "17e098e0-f237-45dc-b8e0-13e34cf275fc", // Lou Basco
];
