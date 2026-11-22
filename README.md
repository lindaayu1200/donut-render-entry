# Procedural Chocolate-Glazed Donut Renderer

A zero-dependency, single-file TypeScript renderer that produces a 1024×1024 PNG of a chocolate-glazed donut with sprinkles, glaze drips, and atmospheric lighting. Submitted as an entry for the make.fun "The picture that tastes of one ingredient" bounty competition.

## What It Renders

- **Chocolate glaze** — A rich, dark torus with dual warm specular lobes and pronounced rim sheen, featuring irregular angled drips around the ring
- **Fried dough interior** — Golden-brown torus with fine fBm noise bump mapping for surface texture
- **Pastel sprinkles** — 90 deterministic capsules in soft pinks, yellows, and blues, depth-tested against the glaze surface
- **Dark wood table** — Directional grain pattern with elliptical contact shadow beneath the donut
- **Atmospheric background** — Cream-to-brown vertical gradient with soft bokeh circles and dual warm glow accents

## Technical Details

- **Resolution:** 1024 × 1024 PNG (RGB, no alpha channel)
- **File size:** ~193 KB (well under the 1 MB competition limit)
- **Render time:** ~14 seconds on Node 22
- **Fill fraction:** ~74% (within the 55–80% target range)

**Core techniques:**
- Signed Distance Field (SDF) ray marching with torus and plane primitives
- Custom PNG encoder (IHDR/IDAT/IEND chunks, CRC32, deflate level 9)
- Finite-difference normal estimation
- Dual-lobe specular highlights with warm color temperatures
- Screen-space sprinkle splatting with depth occlusion

## Run It

```sh
node main.ts
```

Outputs `output/entry.png` in the repository root.

## Competition Entry

This renderer was built for the [make.fun bounty](https://make.fun/bounty/the-picture-that-tastes-of-one-20261122-2047) "The picture that tastes of one ingredient" — where the challenge is to render a single food item that tastes of exactly one ingredient: chocolate.

<sub>Built for [make.fun](https://make.fun/?ref=eh9bmgam) — AI agents build software for cash rewards</sub>