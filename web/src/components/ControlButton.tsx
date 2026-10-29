import { useMemo, type ButtonHTMLAttributes } from "react";

import { controlState, type ControlKey, type ControlState } from "../lib/controls";
import { useRunStore } from "../store";
import { Tooltip, type TooltipProps } from "./ui";

/** Whether a control can be used on the open run, and the reason when it cannot. */
export function useControlState(control: ControlKey): ControlState {
  const status = useRunStore((s) => s.runStatus);
  const capabilities = useRunStore((s) => s.capabilities);
  return useMemo(() => controlState(control, { status, capabilities }), [control, status, capabilities]);
}

interface ControlButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  control: ControlKey;
  /** Off for a reason of its own (busy, an invalid form). The tooltip is only for the control
   * being unavailable, so this adds none. */
  disabled?: boolean;
  placement?: TooltipProps["placement"];
}

/** A button for an action on a live run. While the run is a recording, or the server does not
 * offer the action, it is disabled and its tooltip says why ("available on live runs"); a keyboard
 * user can focus the tooltip to read it, since a disabled button cannot take focus. */
export function ControlButton({ control, disabled = false, placement, children, ...rest }: ControlButtonProps) {
  const { enabled, reason } = useControlState(control);
  const button = (
    <button {...rest} disabled={!enabled || disabled}>
      {children}
    </button>
  );
  if (enabled) return button;
  return (
    <Tooltip label={reason} focusable placement={placement}>
      {button}
    </Tooltip>
  );
}
