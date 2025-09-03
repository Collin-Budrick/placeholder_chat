# htmx, framer-motion, daisyUI in apps/web

This document provides a quick guide and a minimal usage example for integrating htmx, daisyUI, and framer-motion in the web app located at `apps/web`.

## What’s included

- htmx.org for progressive enhancement and simple AJAX-like interactions
- DaisyUI as a Tailwind CSS component library
- Framer Motion for React-based animations (to be used within React components)

Note: The Tailwind configuration already includes the DaisyUI plugin, so you can leverage DaisyUI components in your Tailwind-styled markup.

## Quick usage example (static HTML demonstration)

This HTML demonstrates a button styled with DaisyUI classes that uses htmx attributes to fetch content. The example is self-contained in this snippet and can be adapted into your React components or served as a static page for demonstration.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>htmx + DaisyUI Demo</title>
  </head>
  <body>
    <!-- A DaisyUI-styled button that uses htmx to fetch content -->
    <button class="btn btn-primary" hx-get="/demo/content" hx-target="#content" hx-swap="outerHTML">
      Load content
    </button>

    <!-- Content area that will be replaced by htmx -->
    <div id="content">
      <div class="card w-96 bg-base-100 shadow-xl p-4">
        <div class="card-body">
          <h2 class="card-title">Hello from DaisyUI</h2>
          <p>This is a DaisyUI-styled content block.</p>
        </div>
      </div>
    </div>

    <!-- Load the htmx library (from CDN for demonstration) -->
    <script src="https://unpkg.com/htmx.org@2.0.6"></script>
  </body>
</html>
```

## Integrating with React (framer-motion)

- Framer Motion can be used within React components to animate UI elements. Example usage (in a React component):

```tsx
import { motion } from 'framer-motion';
import React from 'react';

export function AnimatedCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="card w-96 bg-base-100 shadow-xl p-4"
    >
      <div className="card-body">
        <h2 className="card-title">Animated Card</h2>
        <p>This card uses Framer Motion for a simple enter animation.</p>
      </div>
    </motion.div>
  );
}
```

- To wire htmx with React in a single page, you can still use htmx attributes on elements rendered by React. Ensure htmx is loaded (e.g., via a script tag or as a project dependency) and that the server endpoints return HTML fragments suitable for insertion via hx-get/hx-target.

## Next steps

- [ ] Create a small route or static endpoint that returns HTML fragments for the htmx demo
- [ ] Add a real example page wired into the app’s existing routing (e.g., a route that serves the demo HTML)
- [ ] Run the dev server and verify styling and interactions render as expected
