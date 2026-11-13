---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.
license: Apache-2.0
---

# Frontend Design

Adapted from the [Anthropic frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design), licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). This version is shortened and emphasizes minimalism and usability.

Approach the task as a design lead: make deliberate choices about palette, typography, and layout that are specific to the brief and audience, rather than applying a generic template.

## Ground the design in the subject

Identify the product, its audience, and the primary user task before designing. Use the brief's real content and existing product conventions. If essential context is missing, propose a concrete direction and confirm it with the user.

## Plan, build, and critique

1. Develop a compact design plan: a core palette of 4–6 named colors, typefaces and roles, layout and alignment, and a few principles. Sketch and compare layouts when helpful.
2. Review the plan against the brief. Replace choices that feel generic with choices grounded in this product. Honor any visual direction explicitly requested by the user.
3. Build the interface, following the project's existing technology and design conventions. Check CSS specificity and avoid conflicting styles.
4. Critique the result against the brief and, when the environment allows, review screenshots at desktop and mobile widths. Iterate on hierarchy, spacing, legibility, and usability.

## Design principles

- Be restrained: give one element the emphasis, keep supporting elements quiet, and remove decoration that does not help the user or the brief.
- Use typography intentionally: establish a clear type scale, weights, spacing, and readable line lengths. Select typefaces for this product, not merely because they are fashionable.
- Let visual structure convey information. Borders, labels, dividers, and numbering should have a purpose; numbered markers belong on actual sequences.
- Avoid default treatments such as identical rounded cards everywhere, decorative gradients, excessive uppercase labels, and stock hero layouts unless they genuinely fit the brief.
- Use motion sparingly. Prefer action-responsive transitions that explain state changes, and respect reduced-motion preferences.
- Build responsive interfaces with visible keyboard focus, usable contrast, and accessible interaction states.
- Write concise, specific interface copy from the user's perspective. Label actions by what they do, use consistent terminology, and make error and empty states explain the next step.
