// Minimal page that embeds the legacy synth and opens the wallet modal when the iframe requests it
import { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { getIndexerConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'
import { fetchUserPresetAssets, fetchPresetAsset } from './utils/network/fetchPresetAsset'
import ConnectWallet from './components/ConnectWallet'
import { useIframeEvents } from './hooks/useIframeEvents'
import MintSuccessModal from './components/MintSuccessModal'

const Home: React.FC = () => {
  const { activeAccount, activeAddress, wallets, signTransactions } = useWallet()
  const [openWalletModal, setOpenWalletModal] = useState(false)
  const [openMintSuccessModal, setOpenMintSuccessModal] = useState(false)
  const [mintSuccessData, setMintSuccessData] = useState<{ txId: string; assetId?: string }>({ txId: '' })

  useEffect(() => {
    async function handler(e: MessageEvent) {
      switch (e.data.type) {
        case 'OPEN_WALLET_MODAL': {
          setOpenWalletModal(true)
          break
        }
        case 'REQUEST_NFPRESET_LIST': {
          const senderAddr = activeAccount?.address || activeAddress || (wallets?.find(w=>w.isActive)?.accounts?.[0]?.address ?? wallets?.[0]?.accounts?.[0]?.address)
          if (!senderAddr) {
            console.error('No active account found')
            return
          }
          try {
            const indexerConfig = getIndexerConfigFromViteEnvironment()
            const indexer = new algosdk.Indexer(
              String(indexerConfig.token),
              indexerConfig.server,
              String(indexerConfig.port)
            )
            const presets = await fetchUserPresetAssets(indexer, senderAddr)
            const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({
              type: 'NFPRESET_LIST',
              presets: presets
            }, '*')
          } catch (error) {
            console.error('Failed to fetch user preset assets:', error)
            const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({
              type: 'NFPRESET_LIST',
              presets: []
            }, '*')
          }
          break
        }
        case 'REQUEST_NFPRESET_LOAD': {
          const { assetId } = e.data
          if (!assetId) {
            console.error('No asset ID provided')
            return
          }
          try {
            const indexerConfig = getIndexerConfigFromViteEnvironment()
            const indexer = new algosdk.Indexer(
              String(indexerConfig.token),
              indexerConfig.server,
              String(indexerConfig.port)
            )
            const presetAsset = await fetchPresetAsset(indexer, assetId)

            // Pass the preset data directly to the legacy iframe
            const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({
              type: 'NFPRESET_LOAD_RESULT',
              success: true,
              preset: presetAsset.preset
            }, '*')
          } catch (error) {
            console.error('Failed to load preset asset:', error)
            const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({
              type: 'NFPRESET_LOAD_RESULT',
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            }, '*')
          }
          break
        }
        case 'MINT_NFPRESET': {
          const { preset, nftName, unitName, supply, ipfsToken, imageFile } = e.data
          console.log('🔍 Received preset data:', preset)
          console.log('🔍 Preset length:', preset?.length)
          console.log('🔍 First 100 chars:', preset?.substring(0, 100))
          console.log('🔍 Image file:', imageFile)
          const senderAddr = activeAccount?.address || activeAddress || (wallets?.find(w=>w.isActive)?.accounts?.[0]?.address ?? wallets?.[0]?.accounts?.[0]?.address)
          console.log('MINT_NFPRESET senderAddr:', senderAddr)
          if (!senderAddr) {
            alert('Connect wallet before minting')
            const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({ type: 'MINT_NFPRESET_RESULT', success: false, reason: 'notConnected' }, '*')
            break
          }

          if (!ipfsToken) {
            alert('IPFS token is required for ARC-3 NFT minting')
            const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({ type: 'MINT_NFPRESET_RESULT', success: false, reason: 'noIpfsToken' }, '*')
            break
          }

          try {
            // Use MainNet configuration
            const algod = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', '443')

            // Import the ARC-3 minting functions
            const { buildMintPresetTxn } = await import('./utils/network/mintPresetAsset')

            // Create ARC-3 compliant NFT with IPFS metadata
            const params = {
              name: nftName,
              unitName,
              presetBase64: preset,
              ipfsToken,
              total: supply || 1,
              decimals: 0,
              description: `A synthesizer preset for sonifying blockchain transactions`,
              imageFile: imageFile || null
            }

            const txn = await buildMintPresetTxn(algod, senderAddr, params)

            const signed = await signTransactions([txn.toByte()])
            if (!signed || signed.length === 0) throw new Error('User rejected signing')
            const signedBlobs = signed as Uint8Array[]
            const result: unknown = await algod.sendRawTransaction(signedBlobs[0]).do()
            const txId: string = typeof result === 'string' ? result : (result as { txid: string }).txid
            console.log('Mint NFPreset txId', txId)

            // Wait for transaction confirmation and get asset ID
            let assetId: string | undefined
            try {
              const pendingInfo = await algod.pendingTransactionInformation(txId).do()
              if (pendingInfo.assetIndex) {
                assetId = pendingInfo.assetIndex.toString()
              }
            } catch (error) {
              console.warn('Could not get asset ID immediately:', error)
            }

            // Show success modal
            setMintSuccessData({ txId, assetId })
            setOpenMintSuccessModal(true)

            const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({ type: 'MINT_NFPRESET_RESULT', success: true, txId }, '*')
          } catch (err) {
            console.error('Mint NFPreset failed', err)

            // Provide specific error messages for common issues
            let errorMessage = 'Minting failed'
            if (err instanceof Error) {
              if (err.message.includes('401')) {
                errorMessage = 'Invalid IPFS token. Please check your Pinata JWT token.'
              } else if (err.message.includes('IPFS')) {
                errorMessage = 'IPFS upload failed. Please check your token and try again.'
              } else {
                errorMessage = err.message
              }
            }

            alert(errorMessage)
            const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
            iframe?.contentWindow?.postMessage({ type: 'MINT_NFPRESET_RESULT', success: false, error: errorMessage }, '*')
          }
          break
        }
        default:
          break
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [activeAccount, activeAddress, wallets])

  // Debug: Listen to ALL messages
  useState(() => {
    const debugHandler = (e: MessageEvent) => {
      console.log('🔍 ALL messages:', e.data)
    }
    window.addEventListener('message', debugHandler)
    return () => window.removeEventListener('message', debugHandler)
  })

  useIframeEvents(() => setOpenWalletModal(true))

  return (
    <div className="w-screen h-screen bg-teal-400 flex flex-col">
      <iframe src="/legacy.html" title="Legacy Synth" className="w-full h-full border-0 flex-1" />
      {/* Wallet modal from Algokit template */}
      <ConnectWallet openModal={openWalletModal} closeModal={() => setOpenWalletModal(false)} />
      {/* Load Preset modal */}
      {/* Mint Success modal */}
      <MintSuccessModal
        openModal={openMintSuccessModal}
        closeModal={() => setOpenMintSuccessModal(false)}
        txId={mintSuccessData.txId}
        assetId={mintSuccessData.assetId}
      />
    </div>
  )
}

export default Home
