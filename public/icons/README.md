# Extension icons

The icon **is the in-app "Ambient Pulse", miniaturized**: a single luminous
pulse (bright core + one soft ring), centered on a **predominantly blue**
rounded-square tile. No envelope, no "@", no letter-mark — just the pulse that
signals liveness throughout the app (see `design-guidelines.md`, "The Ambient
Pulse").

The tile is a blue→deep-navy radial gradient — **no black** (issue #18: black
read as the dominant color and made the mark feel heavy/inactive; it's been
replaced with desaturated navy so the icon reads unmistakably blue at a glance
and holds shape on both light and dark toolbars). The signal itself is a bright
blue-white core so the pulse pops against the blue field.

## Design tokens (64×64 reference master)

| Element        | Value                                   |
| -------------- | --------------------------------------- |
| Tile           | radial `#2f78de` → `#1b56b4` → `#0a2f6b` (blue, no black) |
| Corner radius  | 14 (~22% of size)                       |
| Core dot       | `#f2f7ff`, diameter ~22% (bright blue-white) |
| Glow           | radial blur ~6%, `rgba(173,210,255,0.40)` |
| Ring           | `#d4e6ff` @ 78% opacity                  |
| Ring stroke    | 1.6px                                   |
| Ring diameter  | ~52% of size, centered on the core      |

## Source of truth

- `icon.svg` — the master, written for clean rendering through `rsvg-convert`.
  Glow is an SVG `<filter>` with `feGaussianBlur`. Edit this for any tweak;
  no raster editor needed.
- `icon16.svg` — a 16×16-specific variant (see the 16px decision below).

## Regenerating the PNGs

```sh
cd public/icons
rsvg-convert -w 16  -h 16  icon16.svg -o icon16.png
rsvg-convert -w 32  -h 32  icon.svg   -o icon32.png
rsvg-convert -w 48  -h 48  icon.svg   -o icon48.png
rsvg-convert -w 128 -h 128 icon.svg   -o icon128.png
```

The manifest filenames are unchanged, so no `manifest.json` edit is needed.

## 16px decision

At 16px the master's 1.5px ring scales to <0.4px and renders as a muddy,
near-invisible halo (tested by rendering `icon.svg` at 16px — the ring did
**not** read). Per issue #12 we keep the ring but tune it for 16px in
`icon16.svg`: the stroke is thickened to 1px and the ring is pulled slightly
outward for clear separation from the dot. The dot + glow are unchanged and
always read. All other sizes (32/48/128) render from the master `icon.svg`.
