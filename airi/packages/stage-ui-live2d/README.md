# Live2D stage

This package owns the Live2D canvas, model lifecycle, motion plugins and display settings.

## Use

Render `Live2DScene` with a model source and display identity. The shared Stage supplies speech and scene state.
The universal motion driver handles eye focus, head motion, idle animation, blinking and expressions.
Manual motion control retains priority. The Magic driver has its own pose source.

`cursorPosition` uses viewport coordinates and expires after one second without updates.
`gazePosition` uses normalized stage coordinates and remains active while supplied by the capture owner.
The parent validates camera freshness and permissions. The scene maps its target through the actual canvas bounds.

## Checks

Run the package's Vitest node configuration for focus and motion tests, then its typecheck.
The Stage UI browser regression covers camera capture and permitted gaze delivery with an external inference fixture.

## Limits

Use this package for Live2D, not VRM or static renderers. It does not own camera capture or face recognition.
Camera head attention uses the universal driver. This change does not add it to the Magic driver.
