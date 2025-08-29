import { useState, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { fetchPresetAsset, fetchUserPresetAssets, PresetAsset } from '../utils/network/fetchPresetAsset'
import { getIndexerConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'

interface LoadPresetModalProps {
  openModal: boolean
  closeModal: () => void
  onPresetLoad: (preset: any) => void
}

export default function LoadPresetModal({ openModal, closeModal, onPresetLoad }: LoadPresetModalProps) {
  const { activeAccount } = useWallet()
  const [isLoading, setIsLoading] = useState(false)
  const [assetId, setAssetId] = useState('')
  const [userPresets, setUserPresets] = useState<PresetAsset[]>([])
  const [error, setError] = useState<string | null>(null)

  // Load user's preset NFTs when modal opens
  useEffect(() => {
    if (openModal && activeAccount?.address) {
      loadUserPresets()
    }
  }, [openModal, activeAccount?.address])

  const loadUserPresets = async () => {
    if (!activeAccount?.address) return

    setIsLoading(true)
    setError(null)
    try {
      const indexerConfig = getIndexerConfigFromViteEnvironment()
      const indexer = new algosdk.Indexer(
        String(indexerConfig.token),
        indexerConfig.server,
        String(indexerConfig.port)
      )

      const presets = await fetchUserPresetAssets(indexer, activeAccount.address)
      setUserPresets(presets)
    } catch (error) {
      console.error('Failed to load user presets:', error)
      setError('Failed to load your preset NFTs')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoadByAssetId = async () => {
    if (!assetId.trim()) {
      setError('Please enter an Asset ID')
      return
    }

    const assetIdNum = parseInt(assetId.trim())
    if (isNaN(assetIdNum)) {
      setError('Please enter a valid Asset ID (number)')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const indexerConfig = getIndexerConfigFromViteEnvironment()
      const indexer = new algosdk.Indexer(
        String(indexerConfig.token),
        indexerConfig.server,
        String(indexerConfig.port)
      )

      const presetAsset = await fetchPresetAsset(indexer, assetIdNum)
      onPresetLoad(presetAsset.preset)
      closeModal()
    } catch (error) {
      console.error('Failed to load preset:', error)
      setError(`Failed to load preset: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoadUserPreset = (presetAsset: PresetAsset) => {
    onPresetLoad(presetAsset.preset)
    closeModal()
  }

  if (!openModal) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Load Preset NFT</h2>
          <button
            onClick={closeModal}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            disabled={isLoading}
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* Load by Asset ID */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Load by Asset ID</h3>
            <div className="flex space-x-3">
              <input
                type="text"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                placeholder="Enter Asset ID (e.g., 123456789)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
              <button
                onClick={handleLoadByAssetId}
                disabled={isLoading || !assetId.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Loading...' : 'Load'}
              </button>
            </div>
          </div>

          {/* User's Preset NFTs */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold">Your Preset NFTs</h3>
              <button
                onClick={loadUserPresets}
                disabled={isLoading}
                className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">Loading your presets...</p>
              </div>
            ) : userPresets.length > 0 ? (
              <div className="grid gap-3 max-h-64 overflow-y-auto">
                {userPresets.map((preset) => (
                  <div
                    key={preset.id}
                    className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => handleLoadUserPreset(preset)}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium">{preset.name || `Asset ${preset.id}`}</h4>
                        <p className="text-sm text-gray-600">
                          Unit: {preset.unitName} • ID: {preset.id}
                        </p>
                        <p className="text-xs text-gray-500">
                          Synths: {Array.isArray(preset.preset?.activeSynths) ? preset.preset.activeSynths.length : 0}
                        </p>
                      </div>
                      <button className="text-blue-600 hover:text-blue-800 text-sm">
                        Load →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <p>No preset NFTs found in your wallet</p>
                <p className="text-sm mt-1">Mint some presets first to see them here</p>
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {/* Close Button */}
          <div className="flex justify-end pt-4">
            <button
              onClick={closeModal}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              disabled={isLoading}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
