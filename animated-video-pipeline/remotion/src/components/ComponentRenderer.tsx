import React from "react";
import { HookStrap }    from "./HookStrap";
import { LowerThird }   from "./LowerThird";
import { StatChip }     from "./StatChip";
import { MapCallout }   from "./MapCallout";
import { ChargeCard }   from "./ChargeCard";
import { ContextPanel } from "./ContextPanel";
import { OutroLockup }  from "./OutroLockup";
import { OverlayProps, SceneData } from "../shared/types";

type OverlayFC = React.FC<OverlayProps>;

const REGISTRY: Record<string, OverlayFC> = {
  HookStrap,
  LowerThird,
  StatChip,
  MapCallout,
  ChargeCard,
  ContextPanel,
  OutroLockup,
};

export function renderOverlayComponents(
  components: Array<{ name: string; delayFrames: number }>,
  scene: SceneData,
  accentColor: string,
): React.ReactNode[] {
  return components.map(({ name, delayFrames }) => {
    const Comp = REGISTRY[name];
    if (!Comp) return null;
    return <Comp key={name} scene={scene} accentColor={accentColor} delayFrames={delayFrames} />;
  });
}
