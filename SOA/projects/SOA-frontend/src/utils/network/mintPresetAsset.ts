import algosdk from 'algosdk'

export interface MintPresetParams {
  /** ARC-3 asset name (up to 32 bytes) */
  name: string
  /** Asset unit name (up to 8 bytes) */
  unitName: string
  /** Compressed preset string (Base64) to store in metadata */
  presetBase64: string
  /** Pinata JWT token for IPFS upload */
  ipfsToken: string
  /** Total supply, defaults to 1 for NFTs */
  total?: number
  /** Decimals, defaults to 0 as per ARC-3 NFTs */
  decimals?: number
  /** Optional description for the NFT */
  description?: string
  /** Optional image file for the NFT (will use placeholder if not provided) */
  imageFile?: File | null
}

/**
 * Uploads JSON metadata to IPFS using Pinata API
 * Adapted from ARC3MintTool's pinJSONToPinata function
 */
export async function uploadMetadataToIPFS(
  token: string,
  metadata: Record<string, unknown>
): Promise<string> {
  try {
    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.trim()}`,
      },
      body: JSON.stringify(metadata),
    })

    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    return result.IpfsHash
  } catch (error) {
    console.error('IPFS upload error:', error)
    throw new Error(`IPFS pinning failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Uploads an image to IPFS and returns its hash
 */
async function uploadImageToIPFS(token: string, imageFile?: File | null): Promise<string> {
  try {
    let imageBlob: Blob;

    if (imageFile) {
      // Use the user-uploaded image
      imageBlob = imageFile;
    } else {
      // Use the placeholder image
      const response = await fetch('/nfplaceholder.png')
      if (!response.ok) {
        throw new Error(`Failed to fetch placeholder image: ${response.status}`)
      }
      imageBlob = await response.blob()
    }

    // Create form data for file upload
    const formData = new FormData()
    formData.append('file', imageBlob, imageFile ? imageFile.name : 'nfplaceholder.png')

    const uploadResponse = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
      },
      body: formData,
    })

    if (!uploadResponse.ok) {
      throw new Error(`Image upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`)
    }

    const result = await uploadResponse.json()
    return result.IpfsHash
  } catch (error) {
    console.error('Image upload error:', error)
    throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Creates ARC-3 compliant metadata JSON for the preset NFT
 */
export async function createArc3Metadata(
  name: string,
  description: string,
  presetBase64: string,
  creator: string,
  ipfsToken: string,
  imageFile?: File | null
): Promise<Record<string, unknown>> {
  // Upload image first (user image or placeholder)
  const imageHash = await uploadImageToIPFS(ipfsToken, imageFile)

  return {
    name,
    description,
    image: `ipfs://${imageHash}`,
    standard: 'arc3',
    properties: {
      preset: presetBase64,
      creator,
      created: new Date().toISOString(),
      version: '1.0'
    }
  }
}

/**
 * Builds an unsigned ASA-create transaction for ARC-3 compliant NFT minting.
 * Returns the Transaction object which can be encoded and passed to the connected wallet for signing.
 */
export async function buildMintPresetTxn(
  algod: algosdk.Algodv2,
  sender: string,
  {
    name,
    unitName,
    presetBase64,
    ipfsToken,
    total = 1,
    decimals = 0,
    description = 'A synthesizer preset for sonifying blockchain transactions',
    imageFile,
  }: MintPresetParams,
): Promise<algosdk.Transaction> {
  console.log('buildMintPresetTxn sender:', sender)
  console.log('buildMintPresetTxn presetBase64 length:', presetBase64?.length)
  if (!presetBase64) throw new Error('presetBase64 is required')
  if (!ipfsToken) throw new Error('ipfsToken is required')

  // Create ARC-3 metadata
  const metadata = await createArc3Metadata(name, description, presetBase64, sender, ipfsToken, imageFile)

  // Upload metadata to IPFS
  console.log('Uploading metadata to IPFS...')
  const ipfsHash = await uploadMetadataToIPFS(ipfsToken, metadata)
  console.log('IPFS hash:', ipfsHash)

  // Create asset URL with ARC-3 suffix
  const assetURL = `ipfs://${ipfsHash}#arc3`

  const suggestedParams = await algod.getTransactionParams().do()

  const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender,
    total,
    decimals,
    defaultFrozen: false,
    manager: sender, // Set manager to creator
    reserve: sender, // Set reserve to creator
    freeze: undefined, // Disable freeze for user-friendly NFTs
    clawback: undefined, // Disable clawback for user-friendly NFTs
    assetName: name,
    unitName,
    assetURL,
    assetMetadataHash: undefined, // Not needed for ARC-3 (uses URL-based metadata)
    suggestedParams,
  })

  return txn
}
