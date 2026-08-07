# PaoPao Fusion V16 UI Art System

Generated production atlases:

- `paopao-ui-kit-transparent.webp` - panels, buttons, counters, medallion, crown, and core controls
- `paopao-hud-controls-transparent.webp` - gameplay HUD and touch/hand controls
- `paopao-map-modes-transparent.webp` - map nodes, path states, worlds, and mode emblems
- `paopao-inventory-rewards-transparent.webp` - currencies, boosters, chests, gifts, and skin token
- `paopao-social-system-transparent.webp` - account, multiplayer, social, cloud, and settings states
- `paopao-overlays-progress-transparent.webp` - story, tooltip, toast, progress, loading, victory, and defeat UI
- `paopao-controls-primitives-transparent.webp` - navigation, toggles, sliders, scrollbar, dividers, and cursor

All runtime atlases are text-free, alpha-transparent WebP assets. Runtime labels and values remain code-rendered for localization and responsive layout. The optimized format reduces the seven-atlas mobile download from about 10.3 MB to about 1.5 MB.

`core/` contains trimmed production crops used by the shared Phaser panel,
button, icon-frame, and command-control helpers. `ui-art-manifest.json` maps
the six 4x3 atlases to stable semantic element names.
