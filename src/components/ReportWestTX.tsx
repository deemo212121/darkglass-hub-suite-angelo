import { westReportData } from "@/lib/reportData";
import { ReportBranchBase } from "./ReportBranchBase";
import type { ModuleDef, SubModuleDef } from "@/lib/modules";
export function ReportWestTX({mod,sub}:{mod:ModuleDef;sub:SubModuleDef}){
  return <ReportBranchBase mod={mod} sub={sub} data={westReportData as any}/>;
}
