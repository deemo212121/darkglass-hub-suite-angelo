import { createContext, useContext, useState } from "react";

interface TicketDetailsContextType {
  selectedTicketNo: string | null;
  setSelectedTicketNo: (ticketNo: string | null) => void;
}

const TicketDetailsContext = createContext<TicketDetailsContextType | undefined>(undefined);

export function TicketDetailsProvider({ children }: { children: React.ReactNode }) {
  const [selectedTicketNo, setSelectedTicketNo] = useState<string | null>(null);

  return (
    <TicketDetailsContext.Provider value={{ selectedTicketNo, setSelectedTicketNo }}>
      {children}
    </TicketDetailsContext.Provider>
  );
}

export function useTicketDetails() {
  const context = useContext(TicketDetailsContext);
  if (!context) {
    throw new Error("useTicketDetails must be used within TicketDetailsProvider");
  }
  return context;
}
