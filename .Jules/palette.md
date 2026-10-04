## 2026-10-04 - Rating System Accessibility
**Learning:** Rating systems using emojis require explicit ARIA labels because screen readers may read the emoji name out of context (e.g., 'rocket' instead of 'excellent') or skip them altogether, making the rating scale ambiguous.
**Action:** Always add descriptive `aria-label` attributes to icon-only buttons, especially in rating or selection scales where the visual metaphor is critical to the meaning.
