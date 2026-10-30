import { useEffect, useState } from 'react';
import { useDataSource } from '@/data/store';
import type { FinancialRow } from '@/data/types';
import { formatMoney } from '@/domain/money';
import { DataTable } from '@/ui/DataTable';
import { Skeleton } from '@/ui/States';

const ec = (minor: number, signed = false) => formatMoney({ currency: 'EC', minor }, { signed, fixed: false });

/**
 * Daily operating statement from the server's stored tick history: revenue, cost of goods, labour, rent, marketing, exchange fees,
 * tax and net profit, plus cash. Only rendered when the data source has such history (the illustrative fixtures do not).
 */
export function OperatingStatement({ companyId, asOf }: { companyId: string; asOf: string }) {
  const source = useDataSource();
  const [rows, setRows] = useState<FinancialRow[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!source.loadFinancials) { setRows(null); return; }
    source.loadFinancials(companyId).then((r) => live && setRows(r), () => live && setRows(null));
    return () => { live = false; };
  }, [source, companyId, asOf]);
  if (rows === undefined) return <Skeleton lines={4} label="Loading operating statement" />;
  if (rows === null) return <p className="pe-hint">Daily operating statements come from the economic engine and are not available for illustrative data.</p>;
  const latest = [...rows].reverse().slice(0, 14);
  return (
    <section aria-labelledby="ops-t" className="pe-stack">
      <h3 id="ops-t" className="pe-h3">Daily operating statement (EC, server data)</h3>
      <DataTable caption="Daily operating statement" rowKey={(r) => String(r.tick)} rows={latest}
        empty={<p className="pe-hint">No days simulated yet.</p>}
        columns={[
          { key: 'd', header: 'Day', render: (r) => `Day ${r.tick}` },
          { key: 'rev', header: 'Revenue', align: 'end', render: (r) => ec(r.revenue) },
          { key: 'cogs', header: 'Cost of goods', align: 'end', render: (r) => ec(r.cogs) },
          { key: 'lab', header: 'Labour', align: 'end', render: (r) => ec(r.labour) },
          { key: 'prop', header: 'Rent', align: 'end', render: (r) => ec(r.property) },
          { key: 'mk', header: 'Marketing', align: 'end', render: (r) => ec(r.marketing) },
          { key: 'fee', header: 'Exchange fees', align: 'end', render: (r) => ec(r.fees) },
          { key: 'tax', header: 'Tax', align: 'end', render: (r) => ec(r.tax) },
          { key: 'np', header: 'Net profit', align: 'end', render: (r) => <span className={r.netProfit > 0 ? 'pe-pos' : r.netProfit < 0 ? 'pe-neg' : ''}>{ec(r.netProfit, true)}</span> },
          { key: 'cash', header: 'Cash', align: 'end', render: (r) => ec(r.cash) },
          { key: 'st', header: 'Status', render: (r) => r.status },
        ]} />
      <p className="pe-hint">Energy is part of cost of goods (it is capitalised into the stock it makes and expensed when sold). Labour, rent and marketing are expensed as they accrue. Unpaid costs become arrears and eventually insolvency.</p>
    </section>
  );
}
