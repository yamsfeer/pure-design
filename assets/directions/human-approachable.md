# Human / approachable — Airbnb / Duolingo systems

> Mood: Friendly and tactile without the generic cozy canvas. Uses a clean neutral background, product-led color system, generous radii, and clear hierarchy. Good for consumer tools, marketplaces, wellness, education, translation, AI assistants, and indie SaaS when the brand has not supplied a palette.

## References
Airbnb, Duolingo product surfaces, Miro, Mercury

## Palette & Fonts (bind verbatim to :root)

```css
:root {
  --bg:      oklch(98% 0.004 240);
  --surface: oklch(100% 0 0);
  --fg:      oklch(20% 0.02 240);
  --muted:   oklch(50% 0.018 240);
  --border:  oklch(90% 0.006 240);
  --accent:  oklch(56% 0.12 170);

  --font-display: 'Söhne', 'Avenir Next', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-body:    -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}
```

## Posture
- sans display with strong weight contrast, system body for readability
- comfortable radii (12–18px) paired with crisp grid alignment
- primary action color plus a secondary/domain accent and clear status colors; use color to separate panels, states, and product moments
- subtle elevation only on interactive cards; tasteful gradients/glows are allowed for hero/device/product moments, never as a full-page beige/pastel wash
- avoid generic pastel/beige gradients; use real product screenshots, data, or labelled placeholders
