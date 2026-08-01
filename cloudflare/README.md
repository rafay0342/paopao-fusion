# PaoPao Fusion Cloudflare runtime

This Worker replaces the always-on Windows/Fastify process for the browser game. It serves the built game and same-origin API, stores durable player data in D1, and runs social presence plus authoritative arena matches in a hibernating Durable Object.

## Production deployment

Use Node.js 22 or newer. Authenticate once, then create the D1 database and let Wrangler write its real UUID into `wrangler.jsonc`:

```cmd
npx wrangler login && npm run db:create && npm run db:remote
```

For production email sign-in, add the Resend key and a sender address already verified in that Resend account. OAuth secrets are optional; unconfigured providers are reported as unavailable by `/api/auth/providers`.

```cmd
npx wrangler secret put RESEND_API_KEY && npx wrangler secret put PAOPAO_EMAIL_FROM && npx wrangler secret put PAOPAO_GOOGLE_CLIENT_ID && npx wrangler secret put PAOPAO_GOOGLE_CLIENT_SECRET && npx wrangler secret put PAOPAO_FACEBOOK_APP_ID && npx wrangler secret put PAOPAO_FACEBOOK_APP_SECRET
```

From the repository root, build and deploy:

```cmd
npm run cloudflare:deploy
```

The deploy script builds a separate `dist-cloudflare` artifact and compresses the opening cinematic below Cloudflare's per-asset limit. The original source video is never modified.

For local development, copy `.dev.vars.example` to `.dev.vars`, use only local test credentials, and run `npm run db:local && npm run dev` from this directory.
