import { Tooltip } from "../../components/ui";
import { MODELS, type ModelKind } from "./models";

export interface ModelProps {
  kind: ModelKind;
  /** What the tag reads, when it says more than the model's name: "Per crash · 5 crashes (C3)". */
  text?: string;
}

/** The failure model a result holds under, as a tag whose hint says what the model is. */
export function Model({ kind, text }: ModelProps) {
  return (
    <Tooltip label={MODELS[kind].says}>
      <span className={`model model--${kind}`} data-model={kind}>
        {text ?? MODELS[kind].name}
      </span>
    </Tooltip>
  );
}
