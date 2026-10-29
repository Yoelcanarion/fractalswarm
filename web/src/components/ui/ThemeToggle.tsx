import { Moon, Sun } from "lucide-react";

import { useTheme } from "../../lib/theme";
import { Tooltip } from "./Tooltip";

/** Switches between the dark theme (the default) and the light one. The choice is kept in this
 * browser and can be forced with `?theme=light` in the URL. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = `Switch to the ${next} theme`;
  return (
    <Tooltip label={label} placement="bottom-end">
      <button type="button" className="icon-btn" onClick={() => setTheme(next)} aria-label={label}>
        {theme === "dark" ? <Sun size={18} strokeWidth={2} aria-hidden /> : <Moon size={18} strokeWidth={2} aria-hidden />}
      </button>
    </Tooltip>
  );
}
