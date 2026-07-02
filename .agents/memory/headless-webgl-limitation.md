---
name: Headless WebGL/Three.js limitation
description: Screenshot tool and Playwright testing subagent cannot create a WebGL context in this sandbox, so Three.js/react-three-fiber canvases can't be verified via those tools.
---

Both `screenshot(type=app_preview)` and the `runTest()` Playwright testing subagent fail on any page that mounts a `<Canvas>` (react-three-fiber / Three.js), with errors like:

```
THREE.WebGLRenderer: A WebGL context could not be created. Reason: Could not create a WebGL context, VENDOR = 0xffff, DEVICE = 0xffff ...
[plugin:runtime-error-plugin] Error creating WebGL context.
```

**Why:** the headless browser used by these tools has no GPU/WebGL backend available in this environment. This reproduces consistently across sessions and is not caused by application code — it happens even on a minimal/working Three.js scene.

**How to apply:** when verifying changes to a WebGL/Three.js/R3F view (e.g. `OceanBasin3D.tsx` in the shizugawa-dashboard project):
- Do not retry `screenshot` or `runTest` on the 3D canvas route expecting a different result — it will fail the same way every time.
- Verify instead via: `pnpm --filter <pkg> run typecheck`, careful code review/reasoning, and confirming non-3D routes in the same app still load fine (proves the dev server/app itself is healthy, isolating the failure to the headless GPU limitation).
- If real visual confirmation is needed, ask the user to check the preview pane themselves (they have a real browser with WebGL support).
