# The Keyboard

A logic signature that authorises one shape of transaction and nothing else: a
zero-amount transfer of an asset that does not exist, paying no more than the
minimum fee. Zero amounts never look up a holding, and an asset ID is just a
uint64, so the note can live in the asset ID itself:

    xaid = 2^40 + midiNote*1000 + velocity

The escrow has no private key. Anyone holding `keyboard.teal` can sign for it,
which means any number of people can play the same instrument at the same time
with no server, no session, and nothing to coordinate — Algorand has no nonces,
so simultaneous senders never collide. The receiver field carries who played:
it costs nothing on a zero transfer, and the sonifier can already filter on it.

    escrow  MDA3CKTPFJUKZLMV2F2DY3C5DYUDHNSJ5KADEOW45LJVVQG3XRA5MGPI3Q

`keyboard.lsig.b64` is the compiled program, committed so the address is
reproducible. Recompiling `keyboard.teal` after any edit gives a different
address — a different instrument.

## Running it

From `SOA/projects/SOA-frontend/`:

    node tools/midi/probe.mjs          # escrow address, balance, shape checks
    node tools/midi/probe.mjs --play   # eight notes into the mainnet mempool

`PLAYER_ADDR` sets the receiver (defaults to the zero address). `ALGOD_SERVER`
defaults to Nodely mainnet.

## Funding

The balance is spendable by anyone who knows the address, 0.001 at a time. That
is the trade for having no key. Keep a busking hat in it — an ALGO or two — and
top it up rather than parking a float there. There is no kill switch: an lsig
cannot be revoked or upgraded, so retiring this instrument means emptying it.
