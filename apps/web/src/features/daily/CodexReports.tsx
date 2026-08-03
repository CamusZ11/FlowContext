import type { DailyProjection } from "@flowcontext/domain";
import { Disclosure } from "./Disclosure";

export interface CodexReportsProps {
  projection?: DailyProjection | null;
}

export function CodexReports({ projection }: CodexReportsProps) {
  return (
    <section className="daily-support-section" aria-labelledby="reports-heading">
      <Disclosure title="Mac / Windows Codex 报告" eyebrow="REPORTS">
        <h3 id="reports-heading">Mac</h3>
        <p className="report-copy">{projection?.macReport || "暂无 Mac 报告。"}</p>
        <h3>Windows</h3>
        <p className="report-copy">{projection?.windowsReport || "暂无 Windows 报告。"}</p>
      </Disclosure>
    </section>
  );
}
