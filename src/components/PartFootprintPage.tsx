import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";

type FootprintRow = {
  receiveDate: string;
  accountNo: string;
  partNo: string;
  uniqueId: string;
  description: string;
  category: string;
  received: number;
  price: number;
  total: number;
  status: string;
  ticketNo: string;
  usedQty: number;
  completeDate: string;
  raNo: string;
  returnQty: string;
  creditDate: string;
  adjustQty: string;
  aging: string;
  brand: string;
  modelCode: string;
  location: string;
};

type PartInfoRow = {
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
};

type PartInfoData = {
  rows: PartInfoRow[];
  availability: { id: string; name: string; qty: number }[];
};

const DEFAULT_PART_INFO: PartInfoData = {
  rows: [
    { leftLabel: "Make", leftValue: "GEH", rightLabel: "Part #", rightValue: "" },
    { leftLabel: "Price", leftValue: "31.56", rightLabel: "Dealer Price", rightValue: "42.83" },
    { leftLabel: "Retail Price", leftValue: "0", rightLabel: "List Price", rightValue: "66.84" },
    { leftLabel: "Core Price", leftValue: "", rightLabel: "Core?", rightValue: "" },
    { leftLabel: "Description", leftValue: "DOOR LOCK", rightLabel: "Discontinue?", rightValue: "false" },
    { leftLabel: "Drop Shop only?", leftValue: "", rightLabel: "Hazmat?", rightValue: "" },
    { leftLabel: "Refrigerant?", leftValue: "false", rightLabel: "Oversize?", rightValue: "false" },
  ],
  availability: [
    { id: "301", name: "LOUISVILLE", qty: 100 },
    { id: "1230", name: "CHARLOTTE", qty: 100 },
    { id: "1260", name: "ALBANY", qty: 100 },
    { id: "7200", name: "FRESNO", qty: 89 },
    { id: "7910", name: "APPLIANCE DENVER", qty: 76 },
    { id: "1010", name: "BYRON CENTER", qty: 73 },
    { id: "601", name: "DENTON", qty: 51 },
    { id: "5300", name: "JACKSONVILLE", qty: 41 },
    { id: "7930", name: "VANCOUVER WA", qty: 39 },
    { id: "401", name: "PEORIA", qty: 36 },
    { id: "201", name: "APPLIANCE LENEXA", qty: 0 },
    { id: "302", name: "LOUISVILLE 2", qty: 0 },
    { id: "1280", name: "GLEN MILLS", qty: 0 },
  ],
};

const PART_INFO_BY_PART: Record<string, PartInfoData> = {
  DEFAULT: DEFAULT_PART_INFO,
  WE04X25194: {
    rows: [
      { leftLabel: "Make", leftValue: "GEH", rightLabel: "Part #", rightValue: "" },
      { leftLabel: "Price", leftValue: "13.18", rightLabel: "Dealer Price", rightValue: "19.46" },
      { leftLabel: "Retail Price", leftValue: "0", rightLabel: "List Price", rightValue: "31.86" },
      { leftLabel: "Core Price", leftValue: "", rightLabel: "Core?", rightValue: "" },
      { leftLabel: "Description", leftValue: "DRYER THERMOSTAT", rightLabel: "Discontinue?", rightValue: "false" },
      { leftLabel: "Drop Shop only?", leftValue: "", rightLabel: "Hazmat?", rightValue: "" },
      { leftLabel: "Refrigerant?", leftValue: "false", rightLabel: "Oversize?", rightValue: "false" },
    ],
    availability: [
      { id: "1230", name: "CHARLOTTE", qty: 39 },
      { id: "7930", name: "VANCOUVER WA", qty: 29 },
      { id: "1010", name: "BYRON CENTER", qty: 20 },
      { id: "1260", name: "ALBANY", qty: 11 },
      { id: "201", name: "APPLIANCE LENEXA", qty: 9 },
      { id: "301", name: "LOUISVILLE", qty: 9 },
      { id: "7200", name: "FRESNO", qty: 9 },
      { id: "7910", name: "APPLIANCE DENVER", qty: 6 },
      { id: "401", name: "PEORIA", qty: 1 },
      { id: "601", name: "DENTON", qty: 1 },
      { id: "302", name: "LOUISVILLE 2", qty: 0 },
      { id: "1280", name: "GLEN MILLS", qty: 0 },
      { id: "5300", name: "JACKSONVILLE", qty: 0 },
    ],
  },
};

const FOOTPRINT_ROWS: FootprintRow[] = [
  { receiveDate: "2026-05-14", accountNo: "", partNo: "QSW-MA169WRZZ", uniqueId: "788392-QSW-MA169WRZZ", description: "", category: "", received: 1, price: 0, total: 0, status: "OP-Waiting for Part", ticketNo: "SMO20260433840533", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "Sharp", modelCode: "SMD2470ASYH", location: "Asheville" },
  { receiveDate: "2026-05-15", accountNo: "", partNo: "WH10X35297", uniqueId: "CB_TS_26000615451DF-AV-WH10X35297", description: "", category: "", received: 1, price: 167.65, total: 167.65, status: "CL-Ready to Complete", ticketNo: "26000615451DF", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PTW600BSRWS", location: "Asheville" },
  { receiveDate: "2026-05-14", accountNo: "272467", partNo: "5304530853", uniqueId: "1-328125-0526-1", description: "", category: "", received: 1, price: 57.89, total: 57.89, status: "OP-Ready for Service", ticketNo: "4044292471BL-2", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "Frigidaire", modelCode: "PRFG2383AFF", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "272467", partNo: "WB16X28670", uniqueId: "1-329541-0526-1", description: "", category: "", received: 1, price: 68.45, total: 68.45, status: "CL-Claimed", ticketNo: "SA-3064113", usedQty: 1, completeDate: "2026-05-14", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "JGSS86SP3SS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "272467", partNo: "WH01X29528", uniqueId: "1-329804-0526-1", description: "", category: "", received: 1, price: 33.76, total: 33.76, status: "CL-Ready to Complete", ticketNo: "SA-3372630", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GFW655SSV0WW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "272467", partNo: "WD21X31502", uniqueId: "1-329805-0526-1", description: "", category: "", received: 1, price: 14.53, total: 14.53, status: "OP-Ready for Service", ticketNo: "SA-3193624", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GDF650SYVFS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "272467", partNo: "WE04X25194", uniqueId: "1-332146-0526-1", description: "", category: "", received: 1, price: 14.69, total: 14.69, status: "CL-Claimed", ticketNo: "3849694E1", usedQty: 1, completeDate: "2026-05-14", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GTX22EASK1WW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "272467", partNo: "WE04X25201", uniqueId: "1-332146-0526-2", description: "", category: "", received: 1, price: 14.79, total: 14.79, status: "CL-Claimed", ticketNo: "3849694E1", usedQty: 1, completeDate: "2026-05-14", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GTX22EASK1WW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "272467", partNo: "WE15X26140", uniqueId: "1-332146-0526-3", description: "", category: "", received: 1, price: 13.55, total: 13.55, status: "CL-Claimed", ticketNo: "3849694E1", usedQty: 1, completeDate: "2026-05-14", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GTX22EASK1WW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "272467", partNo: "5304530853", uniqueId: "1-332242-0526-1", description: "", category: "", received: 1, price: 57.89, total: 57.89, status: "OP-Ready for Service", ticketNo: "1007165225-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "GRFG2353AF", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "272467", partNo: "WH22X37840", uniqueId: "1-335379-0526-1", description: "", category: "", received: 1, price: 123.99, total: 123.99, status: "OP-Ready for Service", ticketNo: "SA-3410398", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GFW655SPV0DS", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "272467", partNo: "WD22X33499", uniqueId: "1-338881-0526-1", description: "", category: "", received: 1, price: 9.29, total: 9.29, status: "CL-Ready to Complete", ticketNo: "SA-3415153", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PDT795SYV6FS", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "272467", partNo: "WD05X35098", uniqueId: "1-338881-0526-2", description: "", category: "", received: 1, price: 22.45, total: 22.45, status: "CL-Ready to Complete", ticketNo: "SA-3415153", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PDT795SYV6FS", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "272467", partNo: "WR29X44279", uniqueId: "1-339015-0526-1", description: "", category: "", received: 1, price: 78.07, total: 78.07, status: "OP-Ready for Service", ticketNo: "SA-3417234", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PGE29BYTFS", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "272467", partNo: "A00141702", uniqueId: "12-602696-0526-1", description: "", category: "", received: 1, price: 34.49, total: 34.49, status: "OP-Waiting for Part", ticketNo: "1006996918-11", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "PDSH4816BF0A", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "272467", partNo: "WR71X43977", uniqueId: "12-603033-0526-1", description: "", category: "", received: 1, price: 28.76, total: 28.76, status: "OP-Waiting for Part", ticketNo: "SA-3270750", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PXD22BYPBFS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WH11X39237", uniqueId: "184578484-WH11X39237", description: "", category: "", received: 1, price: 50.67, total: 50.67, status: "OP-Ready for Service", ticketNo: "SA-3242347", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PFQ83HSLWWW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WH22X35701", uniqueId: "184578484-WH22X35701", description: "", category: "", received: 1, price: 123.11, total: 123.11, status: "OP-Ready for Service", ticketNo: "SA-3242347", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PFQ83HSLWWW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WH22X36270", uniqueId: "184578484-WH22X36270", description: "", category: "", received: 1, price: 156.23, total: 156.23, status: "OP-Ready for Service", ticketNo: "SA-3242347", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PFQ83HSLWWW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WR08X31586", uniqueId: "184578485-WR08X31586", description: "", category: "", received: 1, price: 18.37, total: 18.37, status: "OP-Ready for Service", ticketNo: "SA-3257862", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GZS22DSJXFSS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WR55X24064", uniqueId: "184578485-WR55X24064", description: "", category: "", received: 1, price: 29.61, total: 29.61, status: "OP-Ready for Service", ticketNo: "SA-3257862", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GZS22DSJXFSS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WR55X40445", uniqueId: "184578485-WR55X40445", description: "", category: "", received: 1, price: 231.19, total: 231.19, status: "OP-Ready for Service", ticketNo: "SA-3257862", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GZS22DSJXFSS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WB27X44148", uniqueId: "184587363-WB27X44148", description: "", category: "", received: 1, price: 129.72, total: 129.72, status: "OP-Ready for Service", ticketNo: "SA-3227241", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "P2S930YP8FS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WB27X48970", uniqueId: "184587363-WB27X48970", description: "", category: "", received: 1, price: 157.47, total: 157.47, status: "OP-Ready for Service", ticketNo: "SA-3227241", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "P2S930YP8FS", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "", partNo: "WR02X26153", uniqueId: "184587365-WR02X26153", description: "", category: "", received: 1, price: 4.56, total: 4.56, status: "OP-Ready for Service", ticketNo: "SA-3257862", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GZS22DSJXFSS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WB56X26676", uniqueId: "184587366-WB56X26676", description: "", category: "", received: 1, price: 23.20, total: 23.20, status: "OP-Ready for Service", ticketNo: "SA-3271029", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "JGB61RP4SS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WB56X27780", uniqueId: "184587366-WB56X27780", description: "", category: "", received: 1, price: 61.28, total: 61.28, status: "OP-Ready for Service", ticketNo: "SA-3271029", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "JGB61RP4SS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WB44X48669", uniqueId: "184587368-WB44X48669", description: "", category: "", received: 1, price: 39.37, total: 39.37, status: "OP-Ready for Service", ticketNo: "SA-3286218", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "CTD70DP2NS1", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "162468", partNo: "140195757129", uniqueId: "73947048-1", description: "", category: "", received: 1, price: 30.17, total: 30.17, status: "OP-Ready for Service", ticketNo: "1007121297-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FCRE306XASB", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "162468", partNo: "140195760081", uniqueId: "73947048-3", description: "", category: "", received: 1, price: 33.41, total: 33.41, status: "OP-Ready for Service", ticketNo: "1007121297-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FCRE306XASB", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "162468", partNo: "140252320092", uniqueId: "73947048-5", description: "", category: "", received: 1, price: 67.25, total: 67.25, status: "OP-Ready for Service", ticketNo: "1007121297-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FCRE306XASB", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "162468", partNo: "5304526310", uniqueId: "73947048-7", description: "", category: "", received: 1, price: 20.79, total: 20.79, status: "OP-Ready for Service", ticketNo: "1007121297-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FCRE306XASB", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "162468", partNo: "5304534821", uniqueId: "73947048-9", description: "", category: "", received: 1, price: 8.15, total: 8.15, status: "OP-Ready for Service", ticketNo: "1007121297-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FCRE306XASB", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "5303305677", uniqueId: "73974051-1", description: "", category: "", received: 1, price: 13.75, total: 13.75, status: "OP-Ready for Service", ticketNo: "1007145943-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FRSS26L3AF", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "297286812", uniqueId: "73974051-10", description: "", category: "", received: 1, price: 6.28, total: 6.28, status: "OP-Waiting for Part", ticketNo: "1007100683-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FFTR2045VW", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "5304522324", uniqueId: "73974051-12", description: "", category: "", received: 1, price: 71.50, total: 71.50, status: "OP-Waiting for Part", ticketNo: "1007100683-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FFTR2045VW", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "5304530007", uniqueId: "73974051-14", description: "", category: "", received: 1, price: 41.27, total: 41.27, status: "OP-Waiting for Part", ticketNo: "1007100683-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FFTR2045VW", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "A19676501", uniqueId: "73974051-16", description: "", category: "", received: 1, price: 44.94, total: 44.94, status: "OP-Waiting for Part", ticketNo: "1007100683-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FFTR2045VW", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "5304526057", uniqueId: "73974051-3", description: "", category: "", received: 1, price: 73.71, total: 73.71, status: "OP-Ready for Service", ticketNo: "1007145943-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FRSS26L3AF", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "5304534515", uniqueId: "73974051-5", description: "", category: "", received: 1, price: 162.50, total: 162.50, status: "OP-Ready for Service", ticketNo: "1007145943-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FRSS26L3AF", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "140156010054", uniqueId: "73978427-1", description: "", category: "", received: 1, price: 16.53, total: 16.53, status: "OP-Ready for Service", ticketNo: "1006999848-11", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "GRFS2853AF", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "FPPWFU01", uniqueId: "73978427-3", description: "", category: "", received: 1, price: 53.77, total: 53.77, status: "OP-Ready for Service", ticketNo: "1006999848-11", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "GRFS2853AF", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "DE94-04311A", uniqueId: "74010182-1", description: "ASSY DOOR-MODULE", category: "", received: 1, price: 208.78, total: 208.78, status: "OP-Ready for Service", ticketNo: "26000629408DF", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "SAMSUNG", modelCode: "ME17R7021ES", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "162468", partNo: "5304530011", uniqueId: "74010208-1", description: "", category: "", received: 1, price: 14.00, total: 14.00, status: "OP-Waiting for Part", ticketNo: "1007143353-10", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "FRIGIDAIRE", modelCode: "FRUF2020AN", location: "Atlanta" },
  { receiveDate: "2026-05-15", accountNo: "272467", partNo: "WR87X49387", uniqueId: "8-260831-0526-1", description: "", category: "", received: 1, price: 172.06, total: 172.06, status: "OP-Ready for Service", ticketNo: "SA-3297526", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "PFE28KYNKFS", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WE04X26214", uniqueId: "ATL-TS_3849694E1-WE04X26214", description: "", category: "", received: 1, price: 7.99, total: 7.99, status: "CL-Claimed", ticketNo: "3849694E1", usedQty: 1, completeDate: "2026-05-14", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GTX22EASK1WW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WE04X25280", uniqueId: "ATL-TS_3849706E1-WE04X25280", description: "", category: "", received: 1, price: 69.57, total: 69.57, status: "OP-Ready for Service", ticketNo: "3849706E1", usedQty: 1, completeDate: "", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GTX22EASKWW", location: "Atlanta" },
  { receiveDate: "2026-05-14", accountNo: "", partNo: "WB27X50046", uniqueId: "ge to cx-WB27X50046", description: "", category: "", received: 1, price: 92.83, total: 92.83, status: "CL-Claimed", ticketNo: "SA-2915053", usedQty: 1, completeDate: "2026-05-06", raNo: "", returnQty: "", creditDate: "", adjustQty: "", aging: "", brand: "GENERAL ELECTRIC", modelCode: "GRF600AV1ES", location: "Atlanta" },
];

const LOCATION_OPTIONS = ["Asheville", "Atlanta", "Birmingham"];

function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function getPartInfoData(partNo: string) {
  const key = String(partNo || "").trim().toUpperCase();
  return PART_INFO_BY_PART[key] || PART_INFO_BY_PART.DEFAULT;
}

function escapeHtml(value: string | number) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

export function PartFootprintPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<FootprintRow[]>([]);
  const [location, setLocation] = useState("");
  const [dateFrom, setDateFrom] = useState("2026-05-14");
  const [dateTo, setDateTo] = useState("2026-05-15");
  const [partNoFilter, setPartNoFilter] = useState("");
  const [uniqueIdFilter, setUniqueIdFilter] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("");
  const [resultSearch, setResultSearch] = useState("");
  const [modalPartNo, setModalPartNo] = useState("");
  const [modalTab, setModalTab] = useState<"encompass" | "marcone">("marcone");

  useEffect(() => {
    setRows(FOOTPRINT_ROWS);
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (location && row.location !== location) return false;
      if (dateFrom && row.receiveDate < dateFrom) return false;
      if (dateTo && row.receiveDate > dateTo) return false;
      if (partNoFilter && !String(row.partNo || "").toLowerCase().includes(partNoFilter.toLowerCase())) return false;
      if (uniqueIdFilter && !String(row.uniqueId || "").toLowerCase().includes(uniqueIdFilter.toLowerCase())) return false;
      if (invoiceFilter && ![row.ticketNo, row.uniqueId, row.partNo].join(" ").toLowerCase().includes(invoiceFilter.toLowerCase())) return false;
      if (resultSearch) {
        const blob = [row.receiveDate, row.accountNo, row.partNo, row.uniqueId, row.description, row.category, row.status, row.ticketNo, row.brand, row.modelCode].join(" ").toLowerCase();
        if (!blob.includes(resultSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [dateFrom, dateTo, invoiceFilter, location, partNoFilter, resultSearch, rows, uniqueIdFilter]);

  const partInfoData = getPartInfoData(modalPartNo);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalPartNo("");
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  const renderFields = (data: PartInfoData) =>
    data.rows
      .map((row) => `<tr><td>${escapeHtml(row.leftLabel)}</td><td>${escapeHtml(row.leftValue)}</td><td>${escapeHtml(row.rightLabel)}</td><td>${escapeHtml(row.rightValue)}</td></tr>`)
      .join("");

  const renderAvailability = (data: PartInfoData) =>
    data.availability.map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.name)}</td><td class="money">${escapeHtml(row.qty)}</td></tr>`).join("");

  useEffect(() => {
    const encomp = document.getElementById("partInfoFieldBodyEncompass");
    const marcone = document.getElementById("partInfoFieldBodyMarcone");
    const count = document.getElementById("partInfoAvailabilityCount");
    const availability = document.getElementById("partInfoAvailabilityBody");
    if (!encomp || !marcone || !count || !availability) return;

    encomp.innerHTML = renderFields(partInfoData);
    marcone.innerHTML = renderFields(partInfoData);
    count.textContent = `${partInfoData.availability.length} records found`;
    availability.innerHTML = renderAvailability(partInfoData);
    const overlay = document.getElementById("partInfoModalOverlay");
    if (overlay) {
      overlay.classList.toggle("is-open", Boolean(modalPartNo));
      overlay.setAttribute("aria-hidden", modalPartNo ? "false" : "true");
    }
    const title = document.getElementById("partInfoTitle");
    if (title) title.textContent = modalPartNo ? `Part Info. of (${modalPartNo})` : "Part Info. of ()";
  }, [modalPartNo, partInfoData]);

  const openPartInfoModal = (partNo: string) => {
    setModalPartNo(partNo);
    setModalTab("marcone");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .fp-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1rem;
            color: #fff;
            backdrop-filter: blur(10px);
            width: 100%;
            min-width: 0;
          }
          .fp-panel + .fp-panel { margin-top: 0.9rem; }
          .controls-grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 0.75rem; margin-bottom: 0.7rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field label { font-size: 0.78rem; font-weight: 700; color: #e5e7eb; }
          .field input, .field select { width: 100%; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; }
          .date-range-row { display: flex; align-items: center; gap: 0.4rem; }
          .date-range-row input { flex: 1; }
          .date-range-row span { color: #dbeafe; font-weight: 700; font-size: 0.9rem; }
          .actions-row { display: flex; align-items: flex-start; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.7rem; justify-content: space-between; }
          .result-info { font-size: 0.84rem; font-weight: 600; color: #bfdbfe; }
          .search-input { padding: 0.45rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; min-width: 220px; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; max-width: 100%; min-width: 0; }
          .fp-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; white-space: nowrap; }
          .fp-table thead tr { background: #1e3a5f; color: #fff; }
          .fp-table th { padding: 0.55rem 0.7rem; text-align: left; font-weight: 700; border-bottom: 2px solid #2563eb; white-space: nowrap; }
          .fp-table td { padding: 0.45rem 0.7rem; border-bottom: 1px solid #e5e7eb; color: #111827; vertical-align: middle; }
          .fp-table tbody tr:hover { background: #eff6ff; }
          .fp-table tbody tr:last-child td { border-bottom: none; }
          .total-row td { background: #e5e7eb; font-weight: 700; color: #111827; }
          .ticket-link { color: #2563eb; text-decoration: none; font-weight: 600; }
          .ticket-link:hover { text-decoration: underline; }
          .part-link-btn { border: 0; background: transparent; padding: 0; margin: 0; font: inherit; color: #2563eb; font-weight: 600; text-decoration: none; cursor: pointer; }
          .part-link-btn:hover { text-decoration: underline; }
          .part-info-modal-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: none; align-items: center; justify-content: center; z-index: 2200; padding: 1rem; }
          .part-info-modal-overlay.is-open { display: flex; }
          .part-info-modal { width: min(980px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; background: #ffffff; border: 1px solid #d1d5db; border-radius: 12px; box-shadow: 0 28px 70px rgba(15, 23, 42, 0.3); }
          .part-info-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.9rem 1rem; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
          .part-info-title { font-size: 1rem; font-weight: 700; color: #111827; }
          .part-info-close { border: 1px solid #cbd5e1; background: #ffffff; color: #111827; border-radius: 8px; padding: 0.32rem 0.6rem; cursor: pointer; }
          .part-info-tabs { display: flex; gap: 0.45rem; padding: 0.75rem 1rem 0; }
          .part-info-tab-btn { border: 1px solid #cbd5e1; background: #ffffff; color: #1f2937; padding: 0.4rem 0.85rem; border-radius: 999px; cursor: pointer; font-size: 0.82rem; font-weight: 600; }
          .part-info-tab-btn.active { background: #0f172a; color: #ffffff; border-color: #0f172a; }
          .part-info-body { padding: 0.8rem 1rem 1rem; }
          .part-info-pane { display: none; }
          .part-info-pane.active { display: block; }
          .part-info-matrix { width: 100%; border-collapse: collapse; font-size: 0.79rem; margin-bottom: 0.85rem; }
          .part-info-matrix th, .part-info-matrix td { border: 1px solid #d1d5db; padding: 0.45rem; text-align: left; }
          .part-info-matrix thead th { background: #f3f4f6; font-weight: 700; }
          .part-info-section-title { font-size: 0.82rem; font-weight: 700; color: #111827; margin: 0.2rem 0 0.4rem; }
          .part-info-section-subtitle { font-size: 0.76rem; color: #4b5563; margin-bottom: 0.35rem; }
          .part-info-empty { padding: 0.7rem; border: 1px dashed #d1d5db; border-radius: 8px; font-size: 0.78rem; color: #6b7280; }
          #partInfoModalOverlay .part-info-modal, #partInfoModalOverlay .part-info-modal th, #partInfoModalOverlay .part-info-modal td, #partInfoModalOverlay .part-info-title, #partInfoModalOverlay .part-info-close, #partInfoModalOverlay .part-info-section-title, #partInfoModalOverlay .part-info-section-subtitle, #partInfoModalOverlay .part-info-empty, #partInfoModalOverlay .part-info-tab-btn { color: #111827 !important; }
          #partInfoModalOverlay .part-info-tab-btn.active { color: #ffffff !important; }
          .money { text-align: right; }
          .floating-table-scrollbar { position: fixed; left: 0; bottom: 0; z-index: 1100; overflow-x: auto; overflow-y: hidden; border: 1px solid rgba(148, 163, 184, 0.5); border-radius: 8px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); display: none; max-width: 100vw; }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; min-height: 1px; }
          @media (max-width: 1100px) { .controls-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); } }
          @media (max-width: 700px) { .controls-grid { grid-template-columns: 1fr; } }
        `}</style>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> {mod.label}
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

          <div className="fp-panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="locationFilter">Location</label>
              <select id="locationFilter" value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="">Select Location</option>
                {LOCATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Receive Date</label>
              <div className="date-range-row">
                <input id="dateFrom" type="date" title="Receive date from" aria-label="Receive date from" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                <span>~</span>
                <input id="dateTo" type="date" title="Receive date to" aria-label="Receive date to" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="partNoFilter">Part No</label>
              <input id="partNoFilter" type="text" placeholder="Part No" value={partNoFilter} onChange={(event) => setPartNoFilter(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="uniqueIdFilter">Unique ID</label>
              <input id="uniqueIdFilter" type="text" placeholder="Unique ID" value={uniqueIdFilter} onChange={(event) => setUniqueIdFilter(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="invoiceFilter">Invoice # + (Item #)</label>
              <input id="invoiceFilter" type="text" placeholder="Invoice # + (Item #)" value={invoiceFilter} onChange={(event) => setInvoiceFilter(event.target.value)} />
            </div>
          </div>
        </div>

        <div id="fpResultsPanel" className="fp-panel">
          <div className="actions-row">
            <div id="resultInfo" className="result-info">{filteredRows.length} record{filteredRows.length !== 1 ? "s" : ""} found</div>
            <input id="resultSearch" className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
          </div>

          <div id="fpTableWrap" className="table-wrap">
            <table className="fp-table">
              <thead>
                <tr>
                  <th>Receive Date</th>
                  <th>Account #</th>
                  <th>Part #</th>
                  <th>Unique ID</th>
                  <th>Description*</th>
                  <th>Category</th>
                  <th>Received</th>
                  <th>Price</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Ticket #</th>
                  <th>Used Qty</th>
                  <th>Complete Date</th>
                  <th>RA #</th>
                  <th>Return Qty</th>
                  <th>Credit Date</th>
                  <th>Adjust Qty</th>
                  <th>Aging</th>
                  <th>Brand</th>
                  <th>ModelCode</th>
                </tr>
              </thead>
              <tbody id="fpBody">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={20} className="no-records">No records found.</td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const partCell = row.partNo ? (
                      <button type="button" className="part-link-btn" onClick={() => openPartInfoModal(row.partNo)}>
                        {row.partNo}
                      </button>
                    ) : null;
                    const uniqueIdCell = row.uniqueId ? (
                      <Link className="ticket-link" to="/m/$module/$submodule" params={{ module: mod.slug, submodule: "part-history" }} target="_blank" rel="noreferrer">
                        {row.uniqueId}
                      </Link>
                    ) : null;
                    const ticketCell = row.ticketNo ? (
                      <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: row.ticketNo }} target="_blank" rel="noreferrer">
                        {row.ticketNo}
                      </Link>
                    ) : null;
                    return (
                      <tr key={row.uniqueId}>
                        <td>{row.receiveDate || ""}</td>
                        <td>{row.accountNo || ""}</td>
                        <td>{partCell}</td>
                        <td>{uniqueIdCell}</td>
                        <td>{row.description || ""}</td>
                        <td>{row.category || ""}</td>
                        <td className="money">{row.received || ""}</td>
                        <td className="money">{formatMoney(row.price)}</td>
                        <td className="money">{formatMoney(row.total)}</td>
                        <td>{row.status || ""}</td>
                        <td>{ticketCell}</td>
                        <td className="money">{row.usedQty !== "" && row.usedQty !== undefined ? row.usedQty : ""}</td>
                        <td>{row.completeDate || ""}</td>
                        <td>{row.raNo || ""}</td>
                        <td className="money">{row.returnQty || ""}</td>
                        <td>{row.creditDate || ""}</td>
                        <td className="money">{row.adjustQty || ""}</td>
                        <td>{row.aging || ""}</td>
                        <td>{row.brand || ""}</td>
                        <td>{row.modelCode || ""}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div id="fpFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true">
            <div id="fpFloatingScrollbarInner" className="floating-table-scrollbar-inner" />
          </div>
        </div>

        <div className="fp-panel footnote-panel">
          <p className="footnote-copy"><strong>*Note 1:</strong> Part Footprint shows the current status of a part after receiving. So it shows current reserved, returned and adjusted (except physical inventory) status only.</p>
          <p className="footnote-copy"><strong>*Note 2:</strong> If a part was received, but not reserved, not returned, not adjusted yet, then the parts won't be shown in this page.</p>
        </div>
      </main>

      <footer id="contact">
        <p>For any questions or support, contact us at <a href="mailto:support@adminhubsolutions.com">support@adminhubsolutions.com</a></p>
        <p className="footer-copy">© 2026 Admin Hub Solutions. All rights reserved.</p>
      </footer>

      <div id="partInfoModalOverlay" className={`part-info-modal-overlay ${modalPartNo ? "is-open" : ""}`} onClick={(event) => {
        if (event.target === event.currentTarget) setModalPartNo("");
      }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="part-info-header">
            <div id="partInfoTitle" className="part-info-title">{modalPartNo ? `Part Info. of (${modalPartNo})` : "Part Info. of ()"}</div>
            <button id="partInfoCloseBtn" type="button" className="part-info-close" onClick={() => setModalPartNo("")}>Close</button>
          </div>

          <div className="part-info-tabs">
            <button type="button" className={`part-info-tab-btn ${modalTab === "encompass" ? "active" : ""}`} data-part-tab="encompass" onClick={() => setModalTab("encompass")}>Encompass</button>
            <button type="button" className={`part-info-tab-btn ${modalTab === "marcone" ? "active" : ""}`} data-part-tab="marcone" onClick={() => setModalTab("marcone")}>Marcone</button>
          </div>

          <div className="part-info-body">
            <div className={`part-info-pane ${modalTab === "encompass" ? "active" : ""}`} data-part-pane="encompass">
              <table className="part-info-matrix">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                    <th>Field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody id="partInfoFieldBodyEncompass" dangerouslySetInnerHTML={{ __html: partInfoData.rows.map((row) => `<tr><td>${escapeHtml(row.leftLabel)}</td><td>${escapeHtml(row.leftValue)}</td><td>${escapeHtml(row.rightLabel)}</td><td>${escapeHtml(row.rightValue)}</td></tr>`).join("") }} />
              </table>
              <div className="part-info-section-title">Availability (Encompass)</div>
              <div className="part-info-empty">No availability records found.</div>
            </div>

            <div className={`part-info-pane ${modalTab === "marcone" ? "active" : ""}`} data-part-pane="marcone">
              <table className="part-info-matrix">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                    <th>Field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody id="partInfoFieldBodyMarcone" dangerouslySetInnerHTML={{ __html: partInfoData.rows.map((row) => `<tr><td>${escapeHtml(row.leftLabel)}</td><td>${escapeHtml(row.leftValue)}</td><td>${escapeHtml(row.rightLabel)}</td><td>${escapeHtml(row.rightValue)}</td></tr>`).join("") }} />
              </table>

              <div className="part-info-section-title">Availability (Marcone)</div>
              <div id="partInfoAvailabilityCount" className="part-info-section-subtitle">{partInfoData.availability.length} records found</div>
              <table className="part-info-matrix">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>W/H Name</th>
                    <th>Available Qty</th>
                  </tr>
                </thead>
                <tbody id="partInfoAvailabilityBody" dangerouslySetInnerHTML={{ __html: partInfoData.availability.map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.name)}</td><td class="money">${escapeHtml(row.qty)}</td></tr>`).join("") }} />
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}