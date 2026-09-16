# Dawn

Phone-first giantess bowling-alley RPG. You are speck-sized. Dawn is the actor.

## What’s in here

```
index.html      the game
stills/         scene images
actor/          Cloud Run proxy that talks to Gemini
```

Do not put an API key in this repo.

## Play it

### GitHub Pages

1. Create a new public repo and upload this folder (see below).
2. Repo **Settings → Pages → Deploy from a branch → main / root**.
3. Open `https://YOURUSER.github.io/REPO/?actor=https://YOUR-CLOUD-RUN-URL/actor`

The `?actor=` query is how the page finds Gemini. No key in the HTML.

### Local

Serve the folder (do not use `file://` if you want WebGPU fallback):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/?actor=https://YOUR-CLOUD-RUN-URL/actor`

## Cloud actor

The `actor/` folder is the small Node server. After Cloud Run is deployed:

```
https://dawn-actor-xxxxx-ue.a.run.app/actor
```

Health check: `https://dawn-actor-xxxxx-ue.a.run.app/health`

Redeploy from `actor/` in Cloud Shell only if you change `server.js`. The key stays in Cloud Run env vars, not GitHub.

## If Gemini is down

The page can still try a tiny on-device WebLLM model in Chrome / Safari 26+. That path is slower and weaker. Prefer the `?actor=` URL.
