import { useAtomValue } from "jotai";
import { analysisAtom, effectiveSchemaAtom, hierarchyAtom } from "../state";
import type { Pairing } from "../types";

/* A compact, READ-ONLY view of the table's data hierarchy while composing an
   analysis — the spine is defined in the Data tab. Plus the pairing verdict for
   this comparison (derived from the spine; surfaced for the deferred stats). */
function PairingBadge({ pairing }: { pairing: Pairing }) {
  const cls = pairing.verdict === "paired" ? "paired"
    : pairing.verdict === "partially_paired" ? "partial" : "unpaired";
  const label = pairing.verdict === "partially_paired"
    ? `partially paired across ${pairing.across} (${pairing.n_complete}/${pairing.n_units})`
    : pairing.verdict === "paired" ? `paired across ${pairing.across}` : "unpaired";
  return (
    <div className={`pairing-badge ${cls}`}
      title="Derived from the spine: a comparison is paired over the levels coarser than the qualifier's home. Surfaced now; it picks the test later.">
      <strong>{pairing.qualifier}</strong>: {label}
    </div>
  );
}

export function HierarchyCard() {
  const schema = useAtomValue(effectiveSchemaAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const analysis = useAtomValue(analysisAtom);
  const spine = hierarchy.spine.filter(
    (s) => schema?.columns.some((c) => c.name === s));
  const labelFor = (name: string) =>
    schema?.columns.find((c) => c.name === name)?.label ?? name;
  const pairing = analysis?.stat_model.pairing;
  if (spine.length === 0 && !pairing) return null;

  return (
    <div className="hierarchy-card">
      <div className="rep-key-head">
        <strong>Hierarchy</strong>
        <span className="dim" title="The data's nesting, defined in the Data tab. Layers and the table preview pick a level from it.">
          set in Data tab
        </span>
      </div>
      {spine.length > 0 && (
        <div className="spine-mini">
          {spine.map((s, i) => (
            <span key={s} className="spine-chip">
              {labelFor(s)}{i < spine.length - 1 ? " ›" : ""}
            </span>
          ))}
        </div>
      )}
      {pairing && <PairingBadge pairing={pairing} />}
    </div>
  );
}
