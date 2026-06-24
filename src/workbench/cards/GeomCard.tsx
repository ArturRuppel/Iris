import { EncodingsCard } from "../../components/EncodingsCard";
import { LayerRail } from "../../components/LayerRail";
import type { CardBodyProps } from "../cardRegistry";

/* The geom edge's editor: the encoding (x/y/color) + the geom/layer picker.
   One geom stack per analysis, so every geom edge opens the same editors; both
   bind to the active analysis, so the card needs no target. Decorative
   annotations (reference lines) also live here via the layer config. */
export function GeomCard(_props: CardBodyProps) {
  return (
    <div className="txw-card-geom" data-testid="geom-card">
      <EncodingsCard />
      <LayerRail />
    </div>
  );
}
