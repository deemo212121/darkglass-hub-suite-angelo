import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
import { LOCATIONS } from "@/lib/locations";

type PickupRow = {
  technician: string;
  ticketNo: string;
  repairStatus: string;
  partNo: string;
  description: string;
  poNo: string;
  eta: string;
  uniqueId: string;
  qty: number;
  partStatus: string;
  comment: string;
  pickedUp: string;
  coreValue: number;
  action: string;
  cxAddress: string;
  transit: string;
  zone: string;
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

const STORAGE_KEY = "partPickupRows";

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

const DEFAULT_ROWS: PickupRow[] = [
  { technician: "Jordan Koetsier", ticketNo: "26000649835DF", repairStatus: "OP-UPDATE HOLD", partNo: "", description: "", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "[Part not diagnosed]", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "220 HARVEY GOSNELL RD", transit: "N/A", zone: "Asheville", location: "Asheville" },
  { technician: "Jordan Koetsier", ticketNo: "HSV20260433878814", repairStatus: "CL-Ready to Complete", partNo: "316415900", description: "ELEMENT,BAKE,3500W,6 PASS", poNo: "HSV20260433878814-AV", eta: "", uniqueId: "1-305987-0526-1", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "1531 RIDGEWOOD BLVD", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "Jordan Koetsier", ticketNo: "SA-3128687", repairStatus: "OP-Ready for Service", partNo: "WR49X10251", description: "COVER ASM FF INLET", poNo: "SA-3128687-AV", eta: "", uniqueId: "1-280686-0526-1", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "146 ROBERTS ST", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "Jordan Koetsier", ticketNo: "SA-3128973", repairStatus: "OP-Ready for Service", partNo: "WE21X28957", description: "DRUM ASM 27", poNo: "SA-3128973-AV", eta: "", uniqueId: "184387787-WE21X28957", qty: 1, partStatus: "Part Ready", comment: "GE WE21M41", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "146 ROBERTS ST", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3128973", repairStatus: "OP-Ready for Service", partNo: "WH16X27179", description: "ROD ASSEMBLY 27\"", poNo: "SA-3128973-AV", eta: "", uniqueId: "184467023-WH16X27179", qty: 2, partStatus: "Part Ready", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "146 ROBERTS ST", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3128973", repairStatus: "OP-Ready for Service", partNo: "WH16X27180", description: "ROD ASSEMBLY 27\"", poNo: "SA-3128973-AV", eta: "05/11", uniqueId: "1-279743-0526-1", qty: 2, partStatus: "Part Ready", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "146 ROBERTS ST", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3128973", repairStatus: "OP-Ready for Service", partNo: "WH49X27319", description: "KIT WASHER MOTOR AND PULLEY AS", poNo: "SA-3128973-AV", eta: "05/11", uniqueId: "1-279743-0526-3", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "146 ROBERTS ST", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3128973", repairStatus: "OP-Ready for Service", partNo: "WH49X27322", description: "KIT TRANSMISSION PLATFORM ASM", poNo: "SA-3128973-AV", eta: "05/11", uniqueId: "1-279743-0526-2", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "146 ROBERTS ST", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3128973", repairStatus: "OP-Ready for Service", partNo: "WH49X27327", description: "KIT BASKET 27, HUB NUT, WASHERS & AGITAT", poNo: "SA-3128973-AV", eta: "", uniqueId: "184467023-WH49X27327", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "146 ROBERTS ST", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3128973", repairStatus: "OP-Ready for Service", partNo: "WH49X27329", description: "KIT TUB 27, HUB NUT, WASHERS & WASHER AGITATOR", poNo: "SA-3128973-AV", eta: "", uniqueId: "184387787-WH49X27329", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "146 ROBERTS ST", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "Jordan Koetsier", ticketNo: "26000615451DF", repairStatus: "OP-Waiting for Part", partNo: "WH10X35297", description: "GLASS FRAME LID TL WASHER WHITE", poNo: "26000615451DF-AV", eta: "", uniqueId: "", qty: 1, partStatus: "PO Made", comment: "CB_TS", pickedUp: "", coreValue: 0, action: "", cxAddress: "191 HICKORYNUT ST", transit: "N/A", zone: "Asheville", location: "Asheville" },
  { technician: "Jordan Koetsier", ticketNo: "SA-3179696", repairStatus: "OP-Ready for Service", partNo: "WH01X29528", description: "DOOR LOCK", poNo: "SA-3179696-AV", eta: "", uniqueId: "1-293400-0526-1", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "", coreValue: 0, action: "Undo", cxAddress: "162 S WILLOW BROOK DR", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3179696", repairStatus: "OP-Ready for Service", partNo: "WH01X32580", description: "DOOR LATCH", poNo: "SA-3179696-AV", eta: "", uniqueId: "1-293400-0526-2", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "", coreValue: 0, action: "Undo", cxAddress: "162 S WILLOW BROOK DR", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3179696", repairStatus: "OP-Ready for Service", partNo: "WH03X29524", description: "MOTOR", poNo: "26000554229DF-JS-2", eta: "", uniqueId: "1-270461-0426-1", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP (Used)", coreValue: 0, action: "", cxAddress: "162 S WILLOW BROOK DR", transit: "Used", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3179696", repairStatus: "OP-Ready for Service", partNo: "WH08X29513", description: "MAIN HARNESS", poNo: "SA-3179696-AV", eta: "", uniqueId: "1-293400-0526-5", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "", coreValue: 0, action: "Undo", cxAddress: "162 S WILLOW BROOK DR", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3179696", repairStatus: "OP-Ready for Service", partNo: "WH13X29611", description: "DOOR STRIKE SUPPORT", poNo: "SA-3179696-AV", eta: "", uniqueId: "1-293400-0526-3", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "", coreValue: 0, action: "Undo", cxAddress: "162 S WILLOW BROOK DR", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3179696", repairStatus: "OP-Ready for Service", partNo: "WH22X38697", description: "MAIN CONTROL BOARD FL WASHER", poNo: "SA-3179696-AV", eta: "", uniqueId: "1-293400-0526-4", qty: 1, partStatus: "Tech Pickup", comment: "GE WH22X36858", pickedUp: "", coreValue: 0, action: "Undo", cxAddress: "162 S WILLOW BROOK DR", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "Jordan Koetsier", ticketNo: "SA-3218910", repairStatus: "OP-Ready for Service", partNo: "WR57X24979", description: "VALVE DUAL WATER W FM", poNo: "SA-3218910-AV", eta: "05/11", uniqueId: "1-298990-0526-1", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "17 FAIRMONT RD", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "Jordan Koetsier", ticketNo: "SA-3153278", repairStatus: "OP-Ready for Service", partNo: "WH11X39237", description: "DRAIN PUMP & FILTER", poNo: "SA-3153278-AV", eta: "05/11", uniqueId: "1-298413-0526-1", qty: 1, partStatus: "Part Ready", comment: "GE WH11X29539", pickedUp: "", coreValue: 0, action: "", cxAddress: "83 SPOOKS BRANCH RD", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "SA-3153278", repairStatus: "OP-Ready for Service", partNo: "WH16X29509", description: "DAMPER VENT", poNo: "SA-3153278-AV", eta: "05/11", uniqueId: "1-298413-0526-2", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "83 SPOOKS BRANCH RD", transit: "In-transit", zone: "Asheville", location: "Asheville" },
  { technician: "", ticketNo: "TOTAL", repairStatus: "", partNo: "", description: "", poNo: "", eta: "", uniqueId: "", qty: 21, partStatus: "", comment: "1020501005001", pickedUp: "", coreValue: 0, action: "", cxAddress: "", transit: "", zone: "Asheville", location: "Asheville" },
  { technician: "Andy Oh", ticketNo: "1007096430-10", repairStatus: "CL-Ready to Complete", partNo: "140217719099", description: "PCB,MAIN ELECTRONIC BOARD", poNo: "1007096430-10-MG", eta: "", uniqueId: "1-323730-0526-1", qty: 1, partStatus: "Used", comment: "Electrolux 5304535629", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "375 RIDGEDALE LN", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "1007096430-10", repairStatus: "CL-Ready to Complete", partNo: "5304535645", description: "PC BOARD", poNo: "1007096430-10-MG", eta: "", uniqueId: "1-323730-0526-2", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "375 RIDGEDALE LN", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "Andy Oh", ticketNo: "3344144392BL", repairStatus: "OP-Ready for Service", partNo: "WB16X24722", description: "BURNER XL V2", poNo: "3344144392BL-MG", eta: "", uniqueId: "184553454-WB16X24722", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "9018 MARSTON WAY", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "3344144392BL", repairStatus: "OP-Ready for Service", partNo: "WB18X46238", description: "SWITCH HARNESS ASM", poNo: "3344144392BL-MG", eta: "", uniqueId: "184553454-WB18X46238", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "9018 MARSTON WAY", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "3344144392BL", repairStatus: "OP-Ready for Service", partNo: "WB21X46236", description: "GAS VALVE LF", poNo: "3344144392BL-MG", eta: "", uniqueId: "184525314-WB21X46236", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "9018 MARSTON WAY", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "Andy Oh", ticketNo: "49770008", repairStatus: "CL-Ready to Complete", partNo: "WH12X27614", description: "KIT BRACKET CAPACITOR", poNo: "49770008-MG", eta: "", uniqueId: "1-305031-0526-3", qty: 1, partStatus: "Used", comment: "GE WH12X29017", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "5129 E LINDA CIR", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "49770008", repairStatus: "CL-Ready to Complete", partNo: "WH22X33178", description: "MAIN CONTROL BOARD W/INSTRUCTIONS", poNo: "49770008-MG", eta: "", uniqueId: "1-305031-0526-1", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "5129 E LINDA CIR", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "49770008", repairStatus: "CL-Ready to Complete", partNo: "WH22X35537", description: "USER INTERFACE BOARD", poNo: "49770008-MG", eta: "", uniqueId: "1-305031-0526-2", qty: 1, partStatus: "Used", comment: "GE WH22X32885", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "5129 E LINDA CIR", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "1006802374-10", repairStatus: "CL-Ready to Complete", partNo: "140172164018", description: "VALVE", poNo: "1006802374-10-BM", eta: "04/17", uniqueId: "1-211985-0426-2", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP (Used)", coreValue: 0, action: "", cxAddress: "622 FISH CAMP RD", transit: "Used", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "1006802374-10", repairStatus: "CL-Ready to Complete", partNo: "5304534663", description: "IGNITOR,BAKE", poNo: "1006802374-10-BM", eta: "04/17", uniqueId: "1-211985-0426-1", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP (Used)", coreValue: 0, action: "", cxAddress: "622 FISH CAMP RD", transit: "Used", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "1006802374-10", repairStatus: "CL-Ready to Complete", partNo: "5304534804", description: "OVERLAY,CONTROL,BLACK", poNo: "1006802374-10-BM-2", eta: "", uniqueId: "1-264305-0426-2", qty: 1, partStatus: "Used", comment: "DS REQ 04/28/2026", pickedUp: "PICKED UP (Used)", coreValue: 0, action: "", cxAddress: "622 FISH CAMP RD", transit: "Used", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "1006802374-10", repairStatus: "CL-Ready to Complete", partNo: "5304534808", description: "HARNESS,WIRING,MAIN", poNo: "1006802374-10-BM", eta: "04/22", uniqueId: "1-226290-0426-1", qty: 1, partStatus: "Used", comment: "dropship request 4/16/26", pickedUp: "PICKED UP (Used)", coreValue: 0, action: "", cxAddress: "622 FISH CAMP RD", transit: "Used", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "1006802374-10", repairStatus: "CL-Ready to Complete", partNo: "5304536448", description: "CONTROLLER,ELECTRONIC,OVEN", poNo: "1006802374-10-BM-2", eta: "04/29", uniqueId: "1-264305-0426-1", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP (Used)", coreValue: 0, action: "", cxAddress: "622 FISH CAMP RD", transit: "Used", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "1006855775-10", repairStatus: "OP-Ready for Service", partNo: "5304531521", description: "DOOR ASSEMBLY,FREEZER,WHITE", poNo: "1006855775-10-BM", eta: "", uniqueId: "1-257956-0426-1", qty: 1, partStatus: "Tech Pickup", comment: "DS REQ 04/21/2026", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "11317 HIGHLAND LAKES POINTE", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "HIS20260534001002", repairStatus: "CL-Ready to Complete", partNo: "T345612", description: "R/C\\EN3AH34H\\HU-RCRUS-25\\ROH", poNo: "HIS20260534001002_1", eta: "05/11", uniqueId: "0083473355-T345612", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP (Used)", coreValue: 0, action: "", cxAddress: "810 BROOKLINE RD", transit: "Used", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "HIS20260534001002", repairStatus: "CL-Ready to Complete", partNo: "T401682", description: "MAINBOARDASSEMBLYLARGE COMPONENT\\58A51LU", poNo: "HIS20260534001002_1", eta: "05/11", uniqueId: "0083473355-T401682", qty: 1, partStatus: "Used", comment: "", pickedUp: "PICKED UP (Used)", coreValue: 0, action: "", cxAddress: "810 BROOKLINE RD", transit: "Used", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "SA-3386371", repairStatus: "OP-Ready for Service", partNo: "", description: "", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "[Part not diagnosed]", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "1628 SKYE PASS", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "1007083918-10", repairStatus: "OP-Ready for Service", partNo: "5304538549", description: "PUMP,SYNCHRONOUS", poNo: "1007083918-10-BM", eta: "", uniqueId: "", qty: 1, partStatus: "CX Home", comment: "delivered to cx home", pickedUp: "", coreValue: 0, action: "", cxAddress: "11580 McCord Ln", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "1007168989-10", repairStatus: "OP-Reschedule Follow up", partNo: "", description: "", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "[Part not diagnosed]", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "1227 TARA DR", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "1007180137-10", repairStatus: "OP-Ready for Service", partNo: "", description: "", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "[Part not diagnosed]", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "1235 JOHNSON ST", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "2058727336BL", repairStatus: "OP-Ready for Service", partNo: "140195757129", description: "ELEMENT,BROIL", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "Need PO", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "10407 CALEB CT", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "2058727336BL", repairStatus: "OP-Ready for Service", partNo: "140195760081", description: "ELEMENT HEATING-PUR", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "Need PO", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "10407 CALEB CT", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "2058727336BL", repairStatus: "OP-Ready for Service", partNo: "5304526310", description: "PROBE,OVEN SENSOR", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "Need PO", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "10407 CALEB CT", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "2058727336BL", repairStatus: "OP-Ready for Service", partNo: "5304534821", description: "OVERLAY,OVEN CONTROL,BLACK", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "Need PO", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "10407 CALEB CT", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "2058727336BL", repairStatus: "OP-Ready for Service", partNo: "5304536671", description: "CONTROL-ELEC OVEN,UI305", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "Need PO", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "10407 CALEB CT", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "SA-3091204", repairStatus: "OP-Ready for Service", partNo: "WE03X25275", description: "TRAP DUCT ASM", poNo: "SA-3091204-BM", eta: "05/06", uniqueId: "1-294304-0526-1", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "12431 MCMATH TRL", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "SA-3091204", repairStatus: "OP-Ready for Service", partNo: "WE03X25314", description: "BEARING TOP ASM", poNo: "SA-3091204-BM", eta: "05/06", uniqueId: "1-294304-0526-2", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "12431 MCMATH TRL", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "SA-3331006", repairStatus: "OP-Ready for Service", partNo: "", description: "", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "[Part not diagnosed]", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "657 LIMBAUGH RD", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "David Sims", ticketNo: "1006836710-10", repairStatus: "OP-Ready for Service", partNo: "140282033103", description: "MOTOR,EVAPORATOR FAN,W/HARNESS", poNo: "1006836710-10-BM", eta: "05/08", uniqueId: "1-300254-0526-1", qty: 1, partStatus: "Part Ready", comment: "809069206, DS REQ 04/27/2026", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "14095 ROCKY HILLS DR", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "1006836710-10", repairStatus: "OP-Ready for Service", partNo: "5303305677", description: "DRYER-FILTER", poNo: "1006836710-10-BM", eta: "04/28", uniqueId: "1-256846-0426-2", qty: 1, partStatus: "Part Ready", comment: "Electrolux 242047604", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "14095 ROCKY HILLS DR", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "1006836710-10", repairStatus: "OP-Ready for Service", partNo: "5304530136", description: "COMPRESSOR,ASSEMBLY,VTH1111Y", poNo: "1006836710-10-BM", eta: "04/28", uniqueId: "1-256846-0426-1", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "14095 ROCKY HILLS DR", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "1006836710-10", repairStatus: "OP-Ready for Service", partNo: "5304531506", description: "INVERTER, FLEXDRIVE 2.2", poNo: "1006836710-10-BM", eta: "04/28", uniqueId: "1-256846-0426-3", qty: 1, partStatus: "Part Ready", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "", cxAddress: "14095 ROCKY HILLS DR", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "Memphis Admin", ticketNo: "SA-3167623", repairStatus: "OP-Ready for Service", partNo: "WH03X30517", description: "MODE SHIFTER", poNo: "SA-3167623-JB", eta: "", uniqueId: "17-804077-0526-2", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "1107 EASTWOOD ST", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "SA-3167623", repairStatus: "OP-Ready for Service", partNo: "WH03X32097", description: "TRANSMISSION PULLEY & NUT", poNo: "SA-3167623-JB", eta: "", uniqueId: "17-804077-0526-4", qty: 1, partStatus: "Tech Pickup", comment: "GE WH03X28859", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "1107 EASTWOOD ST", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "SA-3167623", repairStatus: "OP-Ready for Service", partNo: "WH03X33733", description: "PLATFORM BEARING RETAINER & FASTENERS", poNo: "SA-3167623-JB", eta: "", uniqueId: "17-804077-0526-1", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "1107 EASTWOOD ST", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "SA-3167623", repairStatus: "OP-Ready for Service", partNo: "WH05X24185", description: "CLUTCH", poNo: "SA-3167623-JB", eta: "", uniqueId: "17-804077-0526-3", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "1107 EASTWOOD ST", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "SA-3167623", repairStatus: "OP-Ready for Service", partNo: "WH23X28418", description: "PUMP DRAIN ASSEMBLY", poNo: "SA-3167623-JB", eta: "", uniqueId: "17-804077-0526-5", qty: 1, partStatus: "Tech Pickup", comment: "", pickedUp: "PICKED UP", coreValue: 0, action: "Undo", cxAddress: "1107 EASTWOOD ST", transit: "In-transit", zone: "Birmingham", location: "Birmingham" },
  { technician: "Zonate Grant", ticketNo: "1007098673-11", repairStatus: "OP-Ready for Service", partNo: "", description: "", poNo: "", eta: "", uniqueId: "", qty: 1, partStatus: "[Part not diagnosed]", comment: "", pickedUp: "", coreValue: 0, action: "", cxAddress: "20537 EASTE", transit: "N/A", zone: "Birmingham", location: "Birmingham" },
  { technician: "", ticketNo: "TOTAL", repairStatus: "", partNo: "", description: "", poNo: "", eta: "", uniqueId: "", qty: 38, partStatus: "", comment: "1020501005001", pickedUp: "", coreValue: 0, action: "", cxAddress: "", transit: "", zone: "Birmingham", location: "Birmingham" },
];

const ACTION_OPTIONS = ["Pickup", "In-Transit"];

function escapeHtml(value: string | number) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

function getPartInfoData(partNo: string) {
  const key = String(partNo || "").trim().toUpperCase();
  return PART_INFO_BY_PART[key] || PART_INFO_BY_PART.DEFAULT;
}

function loadRows() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as PickupRow[];
    } catch {
      // fall back to seeded rows
    }
  }
  return DEFAULT_ROWS.map((row) => ({ ...row }));
}

export function PartPickupPage({ mod, sub }: { mod: ModuleDef; sub: SubModuleDef }) {
  const [rows, setRows] = useState<PickupRow[]>([]);
  const [location, setLocation] = useState("");
  const [technician, setTechnician] = useState("Jordan Koetsier");
  const [pickupDate, setPickupDate] = useState("2026-05-15");
  const [showNotPicked, setShowNotPicked] = useState(true);
  const [showPicked, setShowPicked] = useState(true);
  const [pickupAction, setPickupAction] = useState("Pickup");
  const [resultSearch, setResultSearch] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [sortBy, setSortBy] = useState("ticket");
  const [activePartNo, setActivePartNo] = useState("");
  const [activePartTab, setActivePartTab] = useState<"encompass" | "marcone">("marcone");

  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const floatingBarRef = useRef<HTMLDivElement | null>(null);
  const floatingInnerRef = useRef<HTMLDivElement | null>(null);
  const syncingFromFloatingRef = useRef(false);
  const syncingFromTableRef = useRef(false);

  useEffect(() => {
    setRows(loadRows());
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!location) return [];
    return rows.filter((row) => {
      if (row.ticketNo === "TOTAL") return false;
      if (row.location && row.location !== location) return false;
      if (technician && !String(row.technician || "").toLowerCase().includes(technician.toLowerCase())) return false;
      const isPicked = String(row.pickedUp || "").toUpperCase().includes("PICKED UP");
      if (!showPicked && isPicked) return false;
      if (!showNotPicked && !isPicked) return false;
      if (resultSearch) {
        const blob = [row.technician, row.ticketNo, row.repairStatus, row.partNo, row.description, row.poNo, row.uniqueId, row.partStatus, row.comment, row.cxAddress, row.transit].join(" ").toLowerCase();
        if (!blob.includes(resultSearch.toLowerCase())) return false;
      }
      return true;
    });
  }, [location, resultSearch, rows, showNotPicked, showPicked, technician]);

  const totalRow = useMemo(() => rows.find((row) => row.ticketNo === "TOTAL" && row.location === location) || null, [location, rows]);

  const summary = useMemo(() => {
    if (!location) return { picked: 0, total: 0 };
    const total = Number(totalRow?.qty || filteredRows.length || 0);
    const picked = filteredRows.filter((row) => String(row.pickedUp || "").toUpperCase().includes("PICKED UP")).length;
    return { picked, total };
  }, [filteredRows, location, totalRow]);

  const updateRows = (updater: (current: PickupRow[]) => PickupRow[]) => {
    setRows((current) => updater(current));
  };

  const undoPickup = (key: string) => {
    const decoded = decodeURIComponent(key || "");
    updateRows((current) =>
      current.map((row) => {
        if ((row.uniqueId || row.ticketNo || "") !== decoded) return row;
        return {
          ...row,
          pickedUp: "",
          transit: row.transit === "Used" ? "In-transit" : row.transit,
        };
      }),
    );
  };

  const markPickupByScan = () => {
    const scanned = scanInput.trim();
    if (!scanned) return;
    updateRows((current) =>
      current.map((row) => {
        if (String(row.uniqueId || "").toLowerCase() !== scanned.toLowerCase()) return row;
        return {
          ...row,
          pickedUp: pickupAction === "In-Transit" ? "IN-TRANSIT" : "PICKED UP",
          transit: pickupAction === "In-Transit" ? "In-transit" : (row.transit || "In-transit"),
        };
      }),
    );
    setScanInput("");
  };

  const addPart = () => {
    const invoice = scanInput.trim();
    if (!invoice) return;
    updateRows((current) => [
      {
        technician: technician.trim(),
        ticketNo: invoice,
        repairStatus: "OP-Ready for Service",
        partNo: "",
        description: "Added manually",
        poNo: invoice,
        eta: "",
        uniqueId: "",
        qty: 1,
        partStatus: "Part Ready",
        comment: "",
        pickedUp: "",
        coreValue: 0,
        action: "",
        cxAddress: "",
        transit: "N/A",
        zone: location || "",
        location: location || "",
      },
      ...current,
    ]);
    setScanInput("");
  };

  const getRowsSorted = () => {
    const rowsToShow = [...filteredRows];
    rowsToShow.sort((left, right) => {
      if (sortBy === "schedule") return String(left.eta || "").localeCompare(String(right.eta || ""));
      return String(left.ticketNo || "").localeCompare(String(right.ticketNo || ""));
    });
    return rowsToShow;
  };

  const activePartInfo = getPartInfoData(activePartNo);

  const syncScrollbar = () => {
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    const floatingInner = floatingInnerRef.current;
    if (!tableWrap || !floatingBar || !floatingInner) return;
    const table = tableWrap.querySelector(".pickup-table") as HTMLTableElement | null;
    if (!table) return;
    floatingInner.style.width = `${table.scrollWidth}px`;
    const rect = tableWrap.getBoundingClientRect();
    floatingBar.style.width = `${Math.max(0, Math.floor(rect.width))}px`;
    floatingBar.style.left = `${Math.max(0, Math.floor(rect.left))}px`;
    floatingBar.style.bottom = "0px";
  };

  const updateScrollbarVisibility = () => {
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    if (!tableWrap || !floatingBar) return;
    const hasHorizontalOverflow = tableWrap.scrollWidth > tableWrap.clientWidth + 1;
    const rect = tableWrap.getBoundingClientRect();
    const viewportBottom = window.innerHeight;
    const scrollbarInViewport = rect.bottom <= viewportBottom && rect.bottom >= 0;
    const tableIntersectsViewport = rect.top < viewportBottom && rect.bottom > 0;
    const shouldShow = hasHorizontalOverflow && tableIntersectsViewport && !scrollbarInViewport;
    floatingBar.classList.toggle("is-visible", shouldShow);
    if (shouldShow) {
      syncScrollbar();
      floatingBar.scrollLeft = tableWrap.scrollLeft;
    }
  };

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    const floatingBar = floatingBarRef.current;
    if (!tableWrap || !floatingBar) return;

    const onFloatingScroll = () => {
      if (syncingFromTableRef.current) {
        syncingFromTableRef.current = false;
        return;
      }
      syncingFromFloatingRef.current = true;
      tableWrap.scrollLeft = floatingBar.scrollLeft;
    };

    const onTableScroll = () => {
      if (syncingFromFloatingRef.current) {
        syncingFromFloatingRef.current = false;
        return;
      }
      syncingFromTableRef.current = true;
      floatingBar.scrollLeft = tableWrap.scrollLeft;
      updateScrollbarVisibility();
    };

    const onResize = () => {
      syncScrollbar();
      updateScrollbarVisibility();
    };

    const onWindowScroll = () => updateScrollbarVisibility();

    floatingBar.addEventListener("scroll", onFloatingScroll);
    tableWrap.addEventListener("scroll", onTableScroll);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onWindowScroll, { passive: true });

    const rafA = window.requestAnimationFrame(() => {
      const rafB = window.requestAnimationFrame(() => {
        syncScrollbar();
        updateScrollbarVisibility();
      });
      return () => window.cancelAnimationFrame(rafB);
    });

    return () => {
      window.cancelAnimationFrame(rafA);
      floatingBar.removeEventListener("scroll", onFloatingScroll);
      tableWrap.removeEventListener("scroll", onTableScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onWindowScroll);
    };
  }, [filteredRows.length, sortBy]);

  useEffect(() => {
    syncScrollbar();
    updateScrollbarVisibility();
  }, [filteredRows.length, location, rows.length, sortBy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActivePartNo("");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!activePartNo) return;
    setActivePartTab("marcone");
  }, [activePartNo]);

  const partInfoPaneClass = (tab: "encompass" | "marcone") => (activePartTab === tab ? "part-info-pane active" : "part-info-pane");

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-8">
        <style>{`
          .pickup-panel {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 10px;
            padding: 1rem;
            color: #fff;
            backdrop-filter: blur(10px);
            width: 100%;
            min-width: 0;
          }
          .pickup-panel + .pickup-panel { margin-top: 0.9rem; }
          .module-page { flex: 1; min-width: 0; }
          .controls-grid { display: grid; grid-template-columns: repeat(3, minmax(170px, 1fr)); gap: 0.75rem; margin-bottom: 0.7rem; }
          .field { display: flex; flex-direction: column; gap: 0.25rem; }
          .field label { font-size: 0.78rem; font-weight: 700; color: #e5e7eb; }
          .field input, .field select { width: 100%; padding: 0.55rem 0.65rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.85rem; }
          .toggle-row, .actions-row, .meta-row, .search-row { display: flex; align-items: flex-start; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.7rem; }
          .actions-row { justify-content: space-between; align-items: flex-start; }
          .labeled-input-row { display: flex; align-items: center; gap: 0.5rem; }
          .input-label { font-size: 0.84rem; font-weight: 600; color: #dbeafe; white-space: nowrap; }
          .toggle-row label { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.84rem; font-weight: 600; color: #dbeafe; }
          .actions-row button, .action-btn { padding: 0.45rem 0.75rem; border-radius: 6px; border: 1px solid rgba(147, 197, 253, 0.7); background: rgba(37, 99, 235, 0.88); color: #fff; font-weight: 700; cursor: pointer; }
          .actions-row button, .actions-row .scan-input, .actions-row .invoice-input, .actions-row .pickup-action { height: 34px; box-sizing: border-box; }
          .pickup-action { width: 170px; padding: 0.45rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; font-weight: 600; cursor: pointer; }
          .scan-stack { display: flex; flex-direction: column; gap: 0.35rem; align-self: flex-start; }
          .inline-action-stack { display: flex; align-items: flex-start; gap: 0.6rem; flex-wrap: wrap; }
          .right-controls { display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem; margin-top: 1.35rem; min-width: 320px; }
          .pickup-btn { padding: 0.5rem 0.9rem; border-radius: 8px; border: 1px solid rgba(147, 197, 253, 0.8); background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #fff; font-weight: 800; letter-spacing: 0.02em; cursor: pointer; box-shadow: 0 8px 18px rgba(37, 99, 235, 0.28); transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; }
          .pickup-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 20px rgba(37, 99, 235, 0.36); background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%); }
          .pickup-btn:active { transform: translateY(0); box-shadow: 0 4px 10px rgba(37, 99, 235, 0.24); }
          .actions-row .scan-input, .actions-row .invoice-input, .search-input { padding: 0.45rem 0.6rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; font-size: 0.84rem; }
          .actions-row .scan-input { min-width: 220px; width: 220px; }
          .actions-row .invoice-input { min-width: 170px; width: 170px; }
          .meta-row { justify-content: flex-start; gap: 0.75rem; }
          .pick-summary { font-weight: 700; color: #bfdbfe; }
          .pick-summary.is-hidden { display: none; }
          .meta-right { display: inline-flex; align-items: center; gap: 0.5rem; }
          .meta-right label { font-weight: 600; font-size: 0.84rem; }
          .meta-right select { padding: 0.42rem 0.55rem; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(17, 24, 39, 0.95); color: #fff; }
          .search-row { justify-content: flex-start; }
          .search-input { min-width: 260px; }
          .table-wrap { overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px; background: #fff; max-width: 100%; min-width: 0; }
          table.pickup-table { width: 100%; min-width: 2200px; border-collapse: collapse; font-size: 0.75rem; color: #111827; }
          .pickup-table th, .pickup-table td { border: 1px solid #d1d5db; padding: 0.42rem; vertical-align: top; white-space: nowrap; }
          .pickup-table th { background: #1f2937; color: #f9fafb; text-align: left; position: sticky; top: 0; z-index: 1; }
          .pickup-table tbody tr:nth-child(even) { background: #f9fafb; }
          .qty, .money { text-align: right; }
          .ticket-link { color: #111827; font-weight: 700; text-decoration: none; }
          .ticket-link:hover { text-decoration: underline; }
          .part-link-btn { border: 0; background: transparent; padding: 0; margin: 0; font: inherit; color: #111827; font-weight: 700; text-decoration: none; cursor: pointer; }
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
          .footer-copy { margin-top: 1rem; opacity: 0.7; }
          #partInfoModalOverlay .part-info-modal, #partInfoModalOverlay .part-info-modal th, #partInfoModalOverlay .part-info-modal td, #partInfoModalOverlay .part-info-title, #partInfoModalOverlay .part-info-close, #partInfoModalOverlay .part-info-section-title, #partInfoModalOverlay .part-info-section-subtitle, #partInfoModalOverlay .part-info-empty, #partInfoModalOverlay .part-info-tab-btn { color: #111827 !important; }
          #partInfoModalOverlay .part-info-tab-btn.active { color: #ffffff !important; }
          .picked { color: #047857; font-weight: 700; }
          .group-row td { background: #e5e7eb; font-weight: 700; color: #111827; }
          .floating-table-scrollbar { position: fixed; left: 0; bottom: 0; z-index: 1100; overflow-x: auto; overflow-y: hidden; border: 1px solid rgba(148, 163, 184, 0.5); border-radius: 8px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); display: none; max-width: 100vw; }
          .floating-table-scrollbar.is-visible { display: block; }
          .floating-table-scrollbar-inner { height: 1px; }
          #contact { margin-top: auto; flex-shrink: 0; width: 100%; }
          @media (max-width: 1100px) { .controls-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); } }
          @media (max-width: 700px) { .controls-grid { grid-template-columns: 1fr; } .meta-row { justify-content: flex-start; } .search-row { justify-content: flex-start; } }
        `}</style>

        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link to="/m/$module" params={{ module: mod.slug }} className="btn hover:bg-white/15">
              <ChevronLeft className="h-4 w-4" /> Parts
            </Link>
          </div>
          <h1 className="text-4xl font-display font-bold tracking-tight mb-2">{sub.title}</h1>
          <p className="text-lg text-muted-foreground">{sub.description}</p>
        </div>

        <div className="pickup-panel">
          <div className="controls-grid">
            <div className="field">
              <label htmlFor="locationFilter">Location*</label>
              <select id="locationFilter" value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="">Select All</option>
                {LOCATIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="technicianFilter">Technician</label>
              <input id="technicianFilter" type="text" value={technician} placeholder="Technician" onChange={(event) => setTechnician(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pickupDate">Pickup Date*</label>
              <input id="pickupDate" type="date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} />
            </div>
          </div>

          <div className="toggle-row">
            <label><input id="showNotPicked" type="checkbox" checked={showNotPicked} onChange={(event) => setShowNotPicked(event.target.checked)} /> Not Picked up</label>
            <label><input id="showPicked" type="checkbox" checked={showPicked} onChange={(event) => setShowPicked(event.target.checked)} /> Picked up</label>
          </div>
        </div>

        <div id="pickupResultsPanel" className="pickup-panel">
          <div className="actions-row">
            <div className="scan-stack">
              <span className="input-label">Scan Parts Here</span>
              <div className="labeled-input-row">
                <input id="scanInput" className="scan-input" type="text" placeholder="Invoice + (Item) #" value={scanInput} onChange={(event) => setScanInput(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    markPickupByScan();
                  }
                }} />
                <button type="button" id="addPartBtn" onClick={addPart}>Add Part</button>
              </div>
              <select id="pickupAction" className="pickup-action" title="Pickup action" aria-label="Pickup action" value={pickupAction} onChange={(event) => setPickupAction(event.target.value)}>
                {ACTION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              {location ? (
                <div id="pickedSummary" className="pick-summary">picked {summary.picked} out of {summary.total} parts</div>
              ) : (
                <div id="pickedSummary" className="pick-summary is-hidden">picked 0 out of 0 parts</div>
              )}
            </div>
            <div className="right-controls">
              <div className="meta-right">
                <label htmlFor="sortBy">Sort by:</label>
                <select id="sortBy" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                  <option value="ticket">Ticket #</option>
                  <option value="schedule">Schedule Time</option>
                </select>
              </div>
              <input id="resultSearch" className="search-input" type="text" placeholder="search in result" value={resultSearch} onChange={(event) => setResultSearch(event.target.value)} />
            </div>
          </div>

          <div id="pickupTableWrap" className="table-wrap" ref={tableWrapRef}>
            <table className="pickup-table">
              <thead>
                <tr>
                  <th>Technician</th>
                  <th>Ticket #</th>
                  <th>Repair Status</th>
                  <th>Part No</th>
                  <th>Description</th>
                  <th>P/O No</th>
                  <th>ETA</th>
                  <th>Unique ID</th>
                  <th>Qty</th>
                  <th>Part Status</th>
                  <th>Comment</th>
                  <th>Picked up</th>
                  <th>CoreValue</th>
                  <th>Actions</th>
                  <th>CxAddress1</th>
                  <th>In-transit</th>
                </tr>
              </thead>
              <tbody id="pickupBody">
                {!location ? (
                  <tr><td colSpan={16}>Select a location to view pickup details.</td></tr>
                ) : (
                  <>
                    {getRowsSorted().map((row) => {
                      const partCell = row.partNo ? <button type="button" className="part-link-btn" onClick={() => setActivePartNo(row.partNo)}>{row.partNo}</button> : null;
                      const uniqueIdCell = row.uniqueId ? <a className="ticket-link" href={`/m/${mod.slug}/part-history?uniqueId=${encodeURIComponent(row.uniqueId)}`} target="_blank" rel="noreferrer">{row.uniqueId}</a> : null;
                      const ticketCell = row.ticketNo ? <Link className="ticket-link" to="/ticket/$ticketNo" params={{ ticketNo: row.ticketNo }} target="_blank" rel="noreferrer">{row.ticketNo}</Link> : null;
                      const pickedClass = String(row.pickedUp || "").toUpperCase().includes("PICKED UP") ? "picked" : "";
                      return (
                        <tr key={`${row.ticketNo}-${row.uniqueId}-${row.partNo}-${row.cxAddress}`}>
                          <td>{row.technician || ""}</td>
                          <td>{ticketCell}</td>
                          <td>{row.repairStatus || ""}</td>
                          <td>{partCell}</td>
                          <td>{row.description || ""}</td>
                          <td>{row.poNo || ""}</td>
                          <td>{row.eta || ""}</td>
                          <td>{uniqueIdCell}</td>
                          <td className="qty">{row.qty || 0}</td>
                          <td>{row.partStatus || ""}</td>
                          <td>{row.comment || ""}</td>
                          <td className={pickedClass}>{row.pickedUp || ""}</td>
                          <td className="money">{row.coreValue || 0}</td>
                          <td>{row.action ? <button className="action-btn" type="button" onClick={() => undoPickup(encodeURIComponent(row.uniqueId || row.ticketNo || ""))}>{row.action}</button> : ""}</td>
                          <td>{row.cxAddress || ""}</td>
                          <td>{row.transit || ""}</td>
                        </tr>
                      );
                    })}
                    {totalRow ? (
                      <tr className="group-row">
                        <td>TOTAL</td>
                        <td colSpan={7}></td>
                        <td className="qty">{totalRow.qty || summary.total}</td>
                        <td colSpan={6}>{totalRow.comment || ""}</td>
                        <td></td>
                      </tr>
                    ) : null}
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div id="pickupFloatingScrollbar" className="floating-table-scrollbar" aria-hidden="true" ref={floatingBarRef}>
            <div id="pickupFloatingScrollbarInner" className="floating-table-scrollbar-inner" ref={floatingInnerRef} />
          </div>
        </div>
      </main>

      <footer id="contact">
        <p>For any questions or support, contact us at <a href="mailto:support@adminhubsolutions.com">support@adminhubsolutions.com</a></p>
        <p className="footer-copy">© 2026 Admin Hub Solutions. All rights reserved.</p>
      </footer>

      <div id="partInfoModalOverlay" className={`part-info-modal-overlay ${activePartNo ? "is-open" : ""}`} onClick={(event) => { if (event.target === event.currentTarget) setActivePartNo(""); }}>
        <div className="part-info-modal" role="dialog" aria-modal="true" aria-labelledby="partInfoTitle">
          <div className="part-info-header">
            <div id="partInfoTitle" className="part-info-title">Part Info. of ({activePartNo})</div>
            <button id="partInfoCloseBtn" type="button" className="part-info-close" onClick={() => setActivePartNo("")}>Close</button>
          </div>

          <div className="part-info-tabs">
            <button type="button" className={`part-info-tab-btn ${activePartTab === "encompass" ? "active" : ""}`} data-part-tab="encompass" onClick={() => setActivePartTab("encompass")}>Encompass</button>
            <button type="button" className={`part-info-tab-btn ${activePartTab === "marcone" ? "active" : ""}`} data-part-tab="marcone" onClick={() => setActivePartTab("marcone")}>Marcone</button>
          </div>

          <div className="part-info-body">
            <div className={partInfoPaneClass("encompass")} data-part-pane="encompass">
              <table className="part-info-matrix">
                <thead>
                  <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                </thead>
                <tbody>
                  {activePartInfo.rows.map((row) => (
                    <tr key={`${row.leftLabel}-${row.rightLabel}`}>
                      <td>{row.leftLabel}</td>
                      <td>{row.leftValue}</td>
                      <td>{row.rightLabel}</td>
                      <td>{row.rightValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="part-info-section-title">Availability (Encompass)</div>
              <div className="part-info-empty">No availability records found.</div>
            </div>

            <div className={partInfoPaneClass("marcone")} data-part-pane="marcone">
              <table className="part-info-matrix">
                <thead>
                  <tr><th>Field</th><th>Value</th><th>Field</th><th>Value</th></tr>
                </thead>
                <tbody>
                  {activePartInfo.rows.map((row) => (
                    <tr key={`${row.leftLabel}-${row.rightLabel}`}>
                      <td>{row.leftLabel}</td>
                      <td>{row.leftValue}</td>
                      <td>{row.rightLabel}</td>
                      <td>{row.rightValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="part-info-section-title">Availability (Marcone)</div>
              <div id="partInfoAvailabilityCount" className="part-info-section-subtitle">{activePartInfo.availability.length} records found</div>
              <table className="part-info-matrix">
                <thead>
                  <tr><th>ID</th><th>W/H Name</th><th>Available Qty</th></tr>
                </thead>
                <tbody>
                  {activePartInfo.availability.map((row) => (
                    <tr key={row.id}>
                      <td>{row.id}</td>
                      <td>{row.name}</td>
                      <td className="qty">{row.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}