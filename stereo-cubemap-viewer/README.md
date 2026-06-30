# VisionCraft Design Studio – Stereo Cubemap Viewer

Static WebXR viewer for Meta Quest 3 that loads a top-bottom stereo cubemap strip and renders the left and right eye cubemaps separately in immersive VR.

## Files

- `index.html`
- `style.css`
- `app.js`

## Run locally

Serve the folder with any static server so WebXR can run on `localhost`:

```bash
cd stereo-cubemap-viewer
python -m http.server 8080
```

Then open:

- `http://localhost:8080`

For Quest Browser, deploy the folder to any HTTPS static host such as Netlify or Vercel.

## Stereo image format

The main expected format is:

- full image = top-bottom stereo strip
- top half = left eye
- bottom half = right eye
- each half = `6 x 1` cubemap strip
- default source order = `+X, -X, +Y, -Y, +Z, -Z`

Example:

- `18432 × 6144`
- each eye row = `18432 × 3072`
- each face = `3072 × 3072`

## Notes

- Scene files are stored locally in IndexedDB.
- The advanced correction panel lets you remap face order and face rotation without re-exporting the render.
- The floating in-VR menu supports reset, next scene, previous scene, and exit VR.
