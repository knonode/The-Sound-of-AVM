import React from 'react'

interface MintSuccessModalProps {
  openModal: boolean
  closeModal: () => void
  txId: string
  assetId?: string
}

export default function MintSuccessModal({ openModal, closeModal, txId, assetId }: MintSuccessModalProps) {
  if (!openModal) return null

  const alloInfoUrl = `https://allo.info/tx/${txId}`
  const peraExplorerUrl = `https://explorer.perawallet.app/tx/${txId}`
  const alloInfoAssetUrl = assetId ? `https://allo.info/asset/${assetId}` : null
  const peraExplorerAssetUrl = assetId ? `https://explorer.perawallet.app/asset/${assetId}` : null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-green-600">🎉 NFPreset Minted Successfully!</h2>
          <button
            onClick={closeModal}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-md p-4">
            <p className="text-green-800 text-sm">
              <strong>Transaction ID:</strong>
            </p>
            <p className="text-green-700 text-xs font-mono break-all mt-1">
              {txId}
            </p>
          </div>

          {assetId && (
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <p className="text-blue-800 text-sm">
                <strong>Asset ID:</strong>
              </p>
              <p className="text-blue-700 text-xs font-mono break-all mt-1">
                {assetId}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="font-semibold text-gray-800">View on Block Explorers:</h3>

            <div className="space-y-2">
              <a
                href={alloInfoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-center text-sm"
              >
                🔍 View on Allo.info
              </a>

              <a
                href={peraExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-center text-sm"
              >
                🔍 View on Pera Explorer
              </a>
            </div>

            {assetId && (
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <p className="text-sm text-gray-600">View Asset Details:</p>
                <a
                  href={alloInfoAssetUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-center text-sm"
                >
                  Asset on Allo
                </a>

                <a
                  href={peraExplorerAssetUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-center text-sm"
                >
                  Asset on Pera Explorer
                </a>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <button
              onClick={closeModal}
              className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
