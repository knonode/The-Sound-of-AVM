// Regenerates the how-to screenshots in public/guide/.
//
//   npm run dev              (in another terminal)
//   npm run guide:shots
//
// Every shot is described by an entry in src/legacy/guide-sections.js — its
// `selector` says what to crop and its `state` says how the page should be set up
// first. Add a section there and it gets captured here automatically; there is no
// second list to keep in sync.
//
// Re-run this after any change to a synth card's layout, or the guide will be
// showing a UI that no longer exists.

import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

import { GUIDE_SECTIONS } from '../src/legacy/guide-sections.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, '..', 'public', 'guide')
const URL = process.env.SOA_URL ?? 'http://localhost:5173/'

// Page setup routines, keyed by the `state` field in GUIDE_SECTIONS. Each one
// receives a page that has just been reloaded, so they never interfere.
const STATES = {
  page: async () => {},

  // pay / amount gives the parameter area its Min + Max inputs.
  default: async (page) => addSynth(page, 'pay', 'amount'),

  // The ASA box that searches by name as well as by id.
  axfer: async (page) => addSynth(page, 'axfer', 'assetid'),

  // Switching engine re-renders the tab strip, so pick the engine first.
  fm: async (page) => {
    await addSynth(page, 'pay', 'amount')
    await clickIn(page, '.engine-btn[data-engine="fm"]')
    await clickIn(page, '.tab-btn[data-tab="extras"]')
  },

  mono: async (page) => {
    await addSynth(page, 'pay', 'amount')
    await clickIn(page, '.engine-btn[data-engine="monosynth"]')
    await clickIn(page, '.tab-btn[data-tab="filterenv"]')
  },

  // Master is injected at boot, but .synth-grid uses auto-fit: a lone card
  // stretches across the whole window. A second card gives it a normal track.
  master: async (page) => {
    await page.click('#add-synth')
    await page.waitForSelector(card)
  },

  // The MIDI card is built by its own button, not picked from the Type menu.
  // A second card gives the auto-fit grid a normal track to draw it in.
  midi: async (page) => {
    await page.click('#add-midi')
    await page.waitForSelector(card)
    await page.click('#add-synth')
    // The device list and the escrow balance both arrive asynchronously, and
    // an empty status line is not what the guide should be showing.
    await page.waitForFunction(
      (sel) => (document.querySelector(sel)?.textContent ?? '').includes('escrow:'),
      '.midi-status',
      { timeout: 8000 },
    ).catch(() => {})
  },

  presets: async (page) => {
    await page.click('#load-preset')
    await page.waitForSelector('#modal-preset-buttons .preset-row')
  },
}

const card = '.mini-synth:not(.master-synth)'

async function addSynth(page, type, subtype) {
  await page.click('#add-synth')
  await page.waitForSelector(card)
  // The selects are wired through delegated change handlers, so selectOption
  // (which dispatches change) is what actually populates the parameter area.
  await page.selectOption(`${card} .type-select`, type)
  await page.waitForFunction(
    ([sel, want]) => document.querySelector(sel)?.querySelector(`option[value="${want}"]`) !== null,
    [`${card} .subtype-select`, subtype],
  )
  await page.selectOption(`${card} .subtype-select`, subtype)
  await page.waitForTimeout(150) // renderParameterArea
}

async function clickIn(page, selector) {
  await page.click(`${card} ${selector}`)
  await page.waitForTimeout(120) // section re-render
}

async function main() {
  // Grouped by viewport width so the browser page is rebuilt once per width,
  // not once per section. Capture order is otherwise irrelevant.
  const shots = GUIDE_SECTIONS.filter((s) => s.selector).sort((a, b) => (a.viewport ?? 700) - (b.viewport ?? 700))
  if (!shots.length) {
    console.error('No sections with a selector — nothing to capture.')
    process.exit(1)
  }

  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (error) {
    console.error(`Cannot reach ${URL} (${error.message}).`)
    console.error('Start the dev server first:  npm run dev')
    process.exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })

  // Clear out stale PNGs so a renamed or deleted section can't leave an orphan
  // behind that the guide silently keeps pointing at.
  const expected = new Set(shots.map((s) => `${s.id}.png`))
  for (const file of await readdir(OUT_DIR)) {
    if (file.endsWith('.png') && !expected.has(file)) {
      await unlink(join(OUT_DIR, file))
      console.log(`  removed stale ${file}`)
    }
  }

  const browser = await chromium.launch()

  const failures = []
  let bytes = 0
  let page = null
  let pageWidth = null

  for (const section of shots) {
    const setup = STATES[section.state]
    if (!setup) {
      failures.push(`${section.id}: unknown state "${section.state}"`)
      continue
    }

    // Synth cards are captured in a narrow window on purpose. .synth-grid is
    // auto-fit, so in a wide window two cards stretch to half the screen each and
    // the crop ends up a wide, sparse band that shrinks to nothing in the modal.
    // 700px gives a card its natural ~337px, leaving room for text beside it.
    // Full-width bars override this (see `viewport` in guide-sections.js).
    const width = section.viewport ?? 700
    if (width !== pageWidth) {
      if (page) await page.close()
      page = await browser.newPage({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2, // crisp on high-dpi screens
      })
      pageWidth = width
    }

    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.top-bar')
      // The first-visit card is a full-screen overlay: it would cover every shot
      // and swallow the clicks the setup routines need.
      await page.evaluate(() => {
        const b = document.getElementById('version-banner')
        if (b) b.style.display = 'none'
      })
      await setup(page)

      const target = page.locator(section.selector).first()
      await target.waitFor({ state: 'visible', timeout: 5000 })
      const out = join(OUT_DIR, `${section.id}.png`)
      await target.screenshot({ path: out })
      bytes += (await stat(out)).size
      console.log(`  ✓ ${section.id}.png`)
    } catch (error) {
      failures.push(`${section.id}: ${error.message.split('\n')[0]}`)
      console.log(`  ✗ ${section.id} — ${error.message.split('\n')[0]}`)
    }
  }

  await browser.close()

  console.log(`\n${shots.length - failures.length}/${shots.length} captured, ${(bytes / 1024).toFixed(0)} KB total`)
  if (failures.length) {
    console.error('\nFailed:')
    failures.forEach((f) => console.error(`  ${f}`))
    process.exit(1)
  }
}

await main()
