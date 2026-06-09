/**
 * Part Order Data Store
 * Manages part orders created from service tickets
 * Part orders auto-sync to PO Management dashboard
 */

export interface StoredPartOrder {
  // Auto-generated identifiers
  poNo: string; // Format: PO-YYMMDD-XXX
  ticketNo: string;
  
  // Part details
  partNo: string;
  partDist: string;
  partDesc: string;
  quantity: number;
  partPrice: number;
  
  // Order timeline
  poDate: string; // ISO date when order was created
  eta: string; // ISO date of expected arrival
  invoiceNo?: string;
  invoiceDate?: string;
  
  // Order tracking
  orderNo?: string; // Distributor order number
  inTracking?: string; // Incoming tracking number
  outTracking?: string; // Return tracking number
  
  // Status
  status: 'Need PO' | 'PO Made' | 'Back Order' | 'Part Ready' | 'Tech Pickup' | 'Claimed' | 'Used' | 'Cancelled';
  itemStatus: 'No-Invoice' | 'Invoiced' | 'Received' | 'Claimed';
  
  // Additional
  note?: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * Generate PO number in format PO-YYMMDD-XXX
 */
export function generatePoNumber(index: number = 0): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const seq = String(index + 1).padStart(3, '0');
  return `PO-${yy}${mm}${dd}-${seq}`;
}

/**
 * Convert ticket part draft to stored part order
 */
export function createPartOrderFromTicket(ticketNo: string, partDraft: any): StoredPartOrder {
  return {
    poNo: partDraft.poNo || generatePoNumber(),
    ticketNo,
    partNo: partDraft.partNo,
    partDist: partDraft.partDist,
    partDesc: partDraft.partDesc,
    quantity: parseInt(partDraft.quantity) || 1,
    partPrice: parseFloat(partDraft.partPrice) || 0,
    poDate: partDraft.poDate || new Date().toISOString().split('T')[0],
    eta: partDraft.eta || '',
    invoiceNo: partDraft.invoiceNo,
    invoiceDate: partDraft.invoiceDate,
    orderNo: partDraft.orderNo,
    inTracking: partDraft.inTracking,
    outTracking: partDraft.outTracking,
    status: (partDraft.status || 'Need PO') as StoredPartOrder['status'],
    itemStatus: (partDraft.invoiceNo ? 'Invoiced' : 'No-Invoice') as StoredPartOrder['itemStatus'],
    note: partDraft.note,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Local storage key for part orders
 */
const STORAGE_KEY = 'ah-solutions:part-orders';

/**
 * Get all part orders from storage
 */
export function getAllPartOrders(): StoredPartOrder[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error reading part orders:', error);
    return [];
  }
}

/**
 * Save or update a part order
 */
export function savePartOrder(order: StoredPartOrder): void {
  try {
    const orders = getAllPartOrders();
    const existingIndex = orders.findIndex(o => o.poNo === order.poNo);
    
    if (existingIndex >= 0) {
      orders[existingIndex] = { ...order, updatedAt: new Date().toISOString() };
    } else {
      orders.push(order);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch (error) {
    console.error('Error saving part order:', error);
  }
}

/**
 * Get part orders for a specific ticket
 */
export function getTicketPartOrders(ticketNo: string): StoredPartOrder[] {
  return getAllPartOrders().filter(order => order.ticketNo === ticketNo);
}

/**
 * Delete a part order
 */
export function deletePartOrder(poNo: string): void {
  try {
    const orders = getAllPartOrders();
    const filtered = orders.filter(o => o.poNo !== poNo);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error deleting part order:', error);
  }
}

/**
 * Get part orders with optional filters
 */
export function getFilteredPartOrders(filters: {
  ticketNo?: string;
  status?: string;
  partDist?: string;
  dateRange?: { start: string; end: string };
}): StoredPartOrder[] {
  try {
    let orders = getAllPartOrders();
    if (!Array.isArray(orders)) orders = [];

    if (filters.ticketNo) {
      orders = orders.filter(o => o.ticketNo === filters.ticketNo);
    }

    if (filters.status) {
      orders = orders.filter(o => o.status === filters.status);
    }

    if (filters.partDist) {
      orders = orders.filter(o => o.partDist === filters.partDist);
    }

    if (filters.dateRange) {
      const start = new Date(filters.dateRange.start);
      const end = new Date(filters.dateRange.end);
      orders = orders.filter(o => {
        const orderDate = new Date(o.poDate);
        return orderDate >= start && orderDate <= end;
      });
    }

    return Array.isArray(orders) ? orders : [];
  } catch (error) {
    console.error('Error filtering part orders:', error);
    return [];
  }
}
