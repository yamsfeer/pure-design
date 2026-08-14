# Tech / utility — Datadog / GitHub

> Mood: Data-dense, monospace-friendly, dark or light + grid. Made for engineers and operators who want information per square inch, not vibes.

## References
Datadog, GitHub, Cloudflare dashboard, Sentry

## Palette & Fonts (bind verbatim to :root)

```css
:root {
  --bg:      oklch(98% 0.005 250);
  --surface: oklch(100% 0 0);
  --fg:      oklch(22% 0.02 240);
  --muted:   oklch(50% 0.018 240);
  --border:  oklch(90% 0.008 240);
  --accent:  oklch(58% 0.16 145);

  --font-display: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
  --font-body:    -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace;
}
```

## Posture
- sans display + sans body (one family) is OK here — utility trumps editorial
- tabular numerics everywhere, mono for code / IDs / hashes
- dense tables with hairline borders, no row striping
- inline status pills (success / warn / danger) with restrained tinted backgrounds
- avoid: hero images, oversized headlines, marketing copy — show the product instead
