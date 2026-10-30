import { Moon, Sun } from "lucide-react";

import { useTheme } from "../../lib/theme";

/** Dark is the default; light is the other theme. The choice is kept in this browser (lib/theme.ts). */
export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = `Switch to the ${next} theme`;
  return (
    <button type="button" className="home-icon-button" onClick={() => setTheme(next)} aria-label={label} title={label}>
      {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
