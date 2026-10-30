// The home page's data file, typed. It is written by scripts/build_home_data.py and never by hand;
// tests/unit/test_home_data.py keeps it in step with the recorded runs and docs/claims.md.

import raw from "./story.json";
import type { Story } from "./types";

export const story = raw as unknown as Story;
