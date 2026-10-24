# Bryt Shell relay

A tiny server that passes **encrypted** "live watch" messages between the person sharing and the people watching.
It cannot read them: the key exists only inside the share code. It stores nothing, logs no message contents,
and forgets a room as soon as the sharer is gone.

## Run it

You need Node 18 or newer.

```
cd relay
npm install
node relay.js            # listens on port 8787 (set PORT=... to change)
```

## Let other people reach it

The relay must be reachable by both people. Pick one:

- **Same Wi-Fi or office network (quickest test):** use the address of the PC running it, for example `ws://192.168.1.20:8787`.
- **A free tunnel from your own PC:** with [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) installed, run
  `cloudflared tunnel --url http://localhost:8787`. It prints an `https://something.trycloudflare.com` address. Use it as `wss://something.trycloudflare.com`.
  The relay only works while your PC and the tunnel are running.
- **A small always-on server or Node host that supports WebSockets:** upload the `relay` folder and run `node relay.js`. Use `wss://your-address`.

Then, in Bryt Shell, put that address in **... menu, Share my work live** (and the watcher in **Watch someone's work**).

## What it can and cannot see

It sees: that a room exists, how many people are connected, the size and timing of messages, and IP addresses (as any server does).
It cannot see: any output, tab names, commands, names, or the code. Protect the code like a password: anyone who has it can watch.

Limits: 8 watchers per share, 256 KB per message, watchers may only send tiny "send me a refresh" notes, and a sharer who loses connection has 60 seconds to come back before the room is closed.
