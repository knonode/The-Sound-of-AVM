import { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'
import { buildMintPresetTxn, MintPresetParams } from '../utils/network/mintPresetAsset'
import algosdk from 'algosdk'

interface MintPresetModalProps {
  openModal: boolean
  closeModal: () => void
  compressedPreset: string | null
}

export default function MintPresetModal({ openModal, closeModal, compressedPreset }: MintPresetModalProps) {
  const { signTransactions, activeAccount } = useWallet()
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    unitName: '',
    ipfsToken: '',
  })

  if (!openModal || !compressedPreset) return null

  const handleMint = async () => {
    if (!activeAccount?.address || !formData.name.trim() || !formData.unitName.trim() || !formData.ipfsToken.trim()) {
      alert('Please fill in all fields and ensure wallet is connected')
      return
    }

    setIsLoading(true)
    try {
      const algodConfig = getAlgodConfigFromViteEnvironment()
      const algod = new algosdk.Algodv2(
        String(algodConfig.token),
        algodConfig.server,
        String(algodConfig.port)
      )

      const params: MintPresetParams = {
        name: formData.name.trim(),
        unitName: formData.unitName.trim(),
        presetBase64: compressedPreset,
        ipfsToken: formData.ipfsToken.trim(),
        total: 1,
        decimals: 0,
        description: `A synthesizer preset for sonifying blockchain transactions`,
      }

      const txn = await buildMintPresetTxn(algod, activeAccount.address, params)

      // Sign the transaction
      const signedTxn = await signTransactions([txn.toByte()])

      // Submit the transaction
      if (!signedTxn || signedTxn.length === 0) {
        throw new Error('Transaction signing failed')
      }

      const signedBlob = signedTxn[0]
      if (!signedBlob) {
        throw new Error('Signed transaction blob is null')
      }

      const result = await algod.sendRawTransaction(signedBlob).do()
      const txId = result.txid

      console.log('🎉 ARC-3 NFT minted successfully! Transaction ID:', txId)
      alert(`ARC-3 NFT minted successfully!\nTransaction ID: ${txId}`)

      // Reset form and close modal
      setFormData({ name: '', unitName: '', ipfsToken: '' })
      closeModal()

    } catch (error) {
      console.error('Failed to mint NFT:', error)
      alert(`Failed to mint NFT: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Mint Preset as ARC-3 NFT</h2>
          <button
            onClick={closeModal}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            disabled={isLoading}
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              NFT Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="My Synth Preset"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={32}
              disabled={isLoading}
            />
            <p className="text-xs text-gray-500 mt-1">Max 32 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Unit Name *
            </label>
            <input
              type="text"
              value={formData.unitName}
              onChange={(e) => setFormData(prev => ({ ...prev, unitName: e.target.value }))}
              placeholder="SYNTH"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={8}
              disabled={isLoading}
            />
            <p className="text-xs text-gray-500 mt-1">Max 8 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pinata JWT Token *
            </label>
            <input
              type="password"
              value={formData.ipfsToken}
              onChange={(e) => setFormData(prev => ({ ...prev, ipfsToken: e.target.value }))}
              placeholder="Enter your Pinata JWT token"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            <p className="text-xs text-gray-500 mt-1">
              Get your token from{' '}
              <a
                href="https://knowledge.pinata.cloud/en/articles/6191471-how-to-create-an-pinata-api-key"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800"
              >
                Pinata
              </a>
            </p>
          </div>

          <div className="bg-gray-50 p-3 rounded-md">
            <p className="text-sm text-gray-600">
              <strong>Preset Size:</strong> {compressedPreset.length} characters (Base64)
            </p>
            <p className="text-xs text-gray-500 mt-1">
              This preset will be stored in ARC-3 metadata on IPFS
            </p>
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              onClick={closeModal}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              onClick={handleMint}
              disabled={isLoading || !formData.name.trim() || !formData.unitName.trim() || !formData.ipfsToken.trim() || !activeAccount}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Minting...' : 'Mint ARC-3 NFT'}
            </button>
          </div>

          {!activeAccount && (
            <p className="text-sm text-red-600 text-center">
              Please connect your wallet to mint
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
