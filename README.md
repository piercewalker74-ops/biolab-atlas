# BioLab Atlas — the genome that rebuilds itself

An interactive, cinematic web explorer for the DNA-repair machinery of
*Deinococcus radiodurans*, the bacterium that survives radiation doses lethal to
almost all other life. Scroll through a volumetric 3D cell and explore the genes
behind its self-repairing genome — with cross-species comparison, expression
data, and plain-language explanations of what each repair factor does.

## Live site

<https://biolab-atlas-deploy.vercel.app/>

## Running locally

It's a fully static site — no build step, no dependencies. Serve the folder with
any static server, for example:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly also works, though a local server is recommended so
`data.json` loads over HTTP.

## What's in here

| Path | What it is |
|------|-----------|
| `index.html` | The full experience (scene, scroll spine, gene stations) |
| `data.json` | Gene atlas — sequences, loci, cross-species identity, expression |
| `assets/` | Rendered background plates and stills |
| `tools/genplate.mjs` | Helper that generated the background plates (needs your own `OPENAI_API_KEY`) |
| `RECIPE-cinematic-volumetric-3d-scene.md` | Build notes for the 3D scene |

## Credits

Gene and sequence references link out to [PubMed](https://pubmed.ncbi.nlm.nih.gov/)
and [NCBI Gene](https://www.ncbi.nlm.nih.gov/gene/). Rendering uses
[Three.js](https://threejs.org/) and [GSAP](https://greensock.com/gsap/).
