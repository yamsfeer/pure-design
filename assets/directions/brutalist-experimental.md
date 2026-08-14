# Brutalist / experimental — Are.na / Yale

> Mood: Loud type. Visible grid. System sans + a single oversized serif. Deliberate ugliness as confidence. Great for art, indie, agency, manifesto pages.

## References
Are.na, Yale Center for British Art, mschf, Read.cv

## Palette & Fonts (bind verbatim to :root)

```css
:root {
  --bg:      oklch(98% 0.004 240);
  --surface: oklch(100% 0 0);
  --fg:      oklch(15% 0.02 100);
  --muted:   oklch(40% 0.02 100);
  --border:  oklch(15% 0.02 100);
  --accent:  oklch(60% 0.22 25);

  --font-display: 'Times New Roman', 'Iowan Old Style', Georgia, serif;
  --font-body:    ui-monospace, 'IBM Plex Mono', 'JetBrains Mono', Menlo, monospace;
}
```

## Posture
- display = serif at extreme sizes (clamp(80px, 12vw, 200px))
- body = monospace — yes, monospace as body, deliberately
- borders are full-strength fg (1.5–2px), not muted greys
- asymmetric layouts: one column 70%, the other 30%
- almost no border-radius (0–2px). No shadows. No gradients.
- underline links, no hover decoration — let the typography carry it
