# polymarket-redeemer

Automatically redeems winning Polymarket positions using the [Polymarket CLI](https://github.com/Polymarket/polymarket-cli). Checks every 15 minutes at candle closes (:04, :19, :34, :49).

## Setup

Install the Polymarket CLI:

```bash
brew tap Polymarket/polymarket-cli https://github.com/Polymarket/polymarket-cli
brew install polymarket
```

Import your wallet:

```bash
polymarket wallet import
```

## Run

```bash
bun run redeemer.js
```
