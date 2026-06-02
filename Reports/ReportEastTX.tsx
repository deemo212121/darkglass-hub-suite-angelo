import { eastReportData } from "@/lib/reportData";
import { ReportBranchBase } from "./ReportBranchBase";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
export function ReportEastTX({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  return <ReportBranchBase mod={mod} sub={sub} data={eastReportData as any}/>;
}
