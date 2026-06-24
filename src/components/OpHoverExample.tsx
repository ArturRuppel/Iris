import type { CannedExample, MiniTable } from "../explorer/cannedExamples";

function Mini({ table, caption }: { table: MiniTable; caption: string }) {
  return (
    <table className="txw-mini" aria-label={caption}>
      <thead><tr>{table.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function OpHoverExample({ example }: { example: CannedExample }) {
  return (
    <div className="txw-hover">
      <div className="txw-hover-tables">
        <div><div className="txw-hcap">before</div><Mini table={example.before} caption="before" /></div>
        <div className="txw-hover-arrow">→</div>
        <div><div className="txw-hcap">after</div><Mini table={example.after} caption="after" /></div>
      </div>
      <div className="txw-hover-note">{example.caption}</div>
    </div>
  );
}
