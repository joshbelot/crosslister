# Crosslister

A free, self-hosted crosslisting app for one person: create a listing once (photos, title, price, condition, brand, category, size), then publish it to Mercari, Poshmark, Depop, Facebook Marketplace, eBay, Grailed and more. Runs locally on a Mac — no cloud, no subscription.

> **Status: specification complete, implementation not started.** This README will be replaced during implementation (see `docs/spec/12-docs-and-delivery.md`).

## How it will work

- **eBay** — fully automatic through eBay's official, free developer API.
- **Mercari, Poshmark, Depop, Facebook Marketplace, Grailed** — *assisted*: none of these offer a public listing API to individual sellers, so the app opens the marketplace in a normal browser window (where you are logged in), fills in the listing, and you review it and click Publish.
- **Vinted, OfferUp, Etsy, anything else** — *manual-assist*: one-click copy of every field, a ready photo folder, and the app records the listing link.
- Your local database is the source of truth: it remembers where every item is listed, so when something sells you mark it sold and remove it everywhere else.

## Documents

| Document | What it is |
|---|---|
| [docs/MARKETPLACE_RESEARCH.md](docs/MARKETPLACE_RESEARCH.md) | Research on every marketplace's API, automation feasibility, anti-bot measures and import options, with sources |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture and key decisions |
| [docs/spec/README.md](docs/spec/README.md) | Step-by-step implementation spec and milestone plan (start here to build it) |
| [CLAUDE.md](CLAUDE.md) | Instructions for the coding agent implementing the spec |

## Building it with a coding agent

Point the agent at this repository and say:

> Implement the app by following `docs/spec/README.md`, milestone by milestone, starting at M1. Follow the rules in `CLAUDE.md`.
