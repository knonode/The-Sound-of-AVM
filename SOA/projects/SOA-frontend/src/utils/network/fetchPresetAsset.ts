import algosdk from 'algosdk'
import { decodePreset, Preset } from '../preset-codec'

export interface PresetAsset {
  /** Asset ID */
  id: number
  /** Asset name */
  name: string
  /** Unit name */
  unitName: string
  /** Decoded preset data */
  preset: Preset
  /** Transaction ID where the asset was created */
  txId: string
  /** Block round when created */
  round: number
  /** Creator address */
  creator: string
  /** Asset URL (IPFS hash for ARC-3) */
  url?: string
}

/**
 * Fetches ARC-3 metadata from IPFS
 */
async function fetchArc3Metadata(ipfsHash: string): Promise<Record<string, unknown>> {
  try {
    // Try multiple IPFS gateways for reliability
    const gateways = [
      `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
      `https://ipfs.io/ipfs/${ipfsHash}`,
      `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
    ]

    for (const gateway of gateways) {
      try {
        const response = await fetch(gateway)
        if (response.ok) {
          return await response.json()
        }
      } catch (error) {
        console.warn(`Failed to fetch from ${gateway}:`, error)
        continue
      }
    }

    throw new Error(`Failed to fetch metadata from all IPFS gateways for hash: ${ipfsHash}`)
  } catch (error) {
    console.error('Error fetching ARC-3 metadata:', error)
    throw error
  }
}

/**
 * Extracts IPFS hash from ARC-3 asset URL
 */
function extractIpfsHash(assetURL: string): string | null {
  if (!assetURL) return null

  // Handle ARC-3 URLs: ipfs://{hash}#arc3
  if (assetURL.includes('ipfs://') && assetURL.includes('#arc3')) {
    const match = assetURL.match(/ipfs:\/\/([^#]+)/)
    return match ? match[1] : null
  }

  // Handle direct IPFS URLs: ipfs://{hash}
  if (assetURL.startsWith('ipfs://')) {
    return assetURL.replace('ipfs://', '')
  }

  return null
}

/**
 * Fetches a preset NFT from the Algorand indexer and decodes the preset data.
 * Supports both legacy note-based storage and ARC-3 IPFS metadata.
 */
export async function fetchPresetAsset(
  indexer: algosdk.Indexer,
  assetId: number,
): Promise<PresetAsset> {
  try {
    // Get asset info
    const assetInfo = await indexer.lookupAssetByID(assetId).do()
    const asset = assetInfo.asset

    if (!asset) {
      throw new Error(`Asset ${assetId} not found`)
    }

    const assetURL = asset.params.url || ''
    const ipfsHash = extractIpfsHash(assetURL)

    let preset: Preset
    let txId: string
    let round: number

    if (ipfsHash) {
      // ARC-3 NFT: fetch metadata from IPFS
      console.log(`Fetching ARC-3 metadata from IPFS: ${ipfsHash}`)
      const metadata = await fetchArc3Metadata(ipfsHash)

      if (!metadata.properties || typeof metadata.properties !== 'object' || !('preset' in metadata.properties)) {
        throw new Error(`ARC-3 metadata for asset ${assetId} does not contain preset data`)
      }

      const presetData = (metadata.properties as Record<string, unknown>).preset
      if (typeof presetData !== 'string') {
        throw new Error(`ARC-3 metadata preset data is not a string for asset ${assetId}`)
      }

      preset = decodePreset(presetData)

      // Get creation transaction info
      const txnResponse = await indexer.searchForTransactions()
        .assetID(assetId)
        .txType('acfg')
        .limit(1)
        .do()

      if (!txnResponse.transactions || txnResponse.transactions.length === 0) {
        throw new Error(`No creation transaction found for asset ${assetId}`)
      }

      const creationTxn = txnResponse.transactions[0]
      txId = creationTxn.id || ''
      round = Number(creationTxn.confirmedRound) || 0

    } else {
      // Legacy NFT: try to get preset from transaction note
      console.log(`Attempting legacy note-based preset extraction for asset ${assetId}`)

      const txnResponse = await indexer.searchForTransactions()
        .assetID(assetId)
        .txType('acfg')
        .limit(1)
        .do()

      if (!txnResponse.transactions || txnResponse.transactions.length === 0) {
        throw new Error(`No creation transaction found for asset ${assetId}`)
      }

      const creationTxn = txnResponse.transactions[0]

      if (!creationTxn.note) {
        throw new Error(`Asset ${assetId} is not a preset NFT (no note field or ARC-3 metadata)`)
      }

      // Decode the note field (Base64) to get the preset
      const noteString = Buffer.from(creationTxn.note).toString('base64')
      preset = decodePreset(noteString)
      txId = creationTxn.id || ''
      round = Number(creationTxn.confirmedRound) || 0
    }

    return {
      id: assetId,
      name: asset.params.name || '',
      unitName: asset.params.unitName || '',
      preset,
      txId,
      round,
      creator: asset.params.creator,
      url: assetURL,
    }
  } catch (error) {
    console.error(`Failed to fetch preset asset ${assetId}:`, error)
    throw error
  }
}

/**
 * Fetches all preset NFTs owned by a specific address.
 * Supports both legacy note-based and ARC-3 IPFS-based preset NFTs.
 */
export async function fetchUserPresetAssets(
  indexer: algosdk.Indexer,
  address: string,
): Promise<PresetAsset[]> {
  try {
    // Get all assets owned by the address
    const accountResponse = await indexer.lookupAccountByID(address).do()
    const assets = accountResponse.account.assets || []

    const presetAssets: PresetAsset[] = []

    // For each asset, try to fetch its preset data
    for (const assetHolding of assets) {
      try {
        const presetAsset = await fetchPresetAsset(indexer, Number(assetHolding.assetId))
        presetAssets.push(presetAsset)
      } catch (error) {
        // Skip assets that don't have preset data (e.g., regular NFTs, tokens)
        console.warn(`Skipping asset ${assetHolding.assetId}: not a preset NFT`)
      }
    }

    return presetAssets
  } catch (error) {
    console.error(`Failed to fetch preset assets for ${address}:`, error)
    throw error
  }
}
