import { useWallet, Wallet, WalletId } from '@txnlab/use-wallet-react'
import Account from './Account'

interface ConnectWalletInterface {
  openModal: boolean
  closeModal: () => void
}

const ConnectWallet = ({ openModal, closeModal }: ConnectWalletInterface) => {
  const { wallets, activeAddress } = useWallet()

  const isKmd = (wallet: Wallet) => wallet.id === WalletId.KMD

  if (!openModal) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
      <div
        className="rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto"
        style={{
          background: 'linear-gradient(135deg, rgba(0, 77, 77, 0.95), rgba(0, 26, 26, 0.95))',
          border: '1px solid rgba(0, 102, 102, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
        }}
      >
        <div className="flex justify-between items-center mb-6">
          <h3
            className="text-xl font-bold"
            style={{ color: '#FFFFFF', fontFamily: 'Arial, sans-serif' }}
          >
            🎛️ Connect Wallet
          </h3>
          <button
            onClick={closeModal}
            className="text-gray-400 hover:text-white text-2xl"
            style={{ fontSize: '24px', lineHeight: '1' }}
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {activeAddress && (
            <>
              <div
                className="rounded p-4"
                style={{
                  backgroundColor: 'rgba(0, 102, 102, 0.3)',
                  border: '1px solid rgba(0, 102, 102, 0.5)'
                }}
              >
                <Account />
              </div>
              <div style={{ borderTop: '1px solid rgba(0, 102, 102, 0.3)', paddingTop: '16px' }} />
            </>
          )}

          {!activeAddress && (
            <div className="space-y-3">
              {wallets?.map((wallet) => (
                <button
                  data-test-id={`${wallet.id}-connect`}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded transition-all hover:scale-105"
                  style={{
                    backgroundColor: 'rgba(0, 102, 102, 0.8)',
                    color: 'white',
                    border: '1px solid rgba(0, 153, 153, 0.5)',
                    fontFamily: 'Arial, sans-serif',
                    fontSize: '14px'
                  }}
                  key={`provider-${wallet.id}`}
                  onClick={async () => {
                    await wallet.connect()
                    // automatically activate first account if none active
                    if (!activeAddress && wallet.accounts && wallet.accounts.length) {
                      if (typeof wallet.setActiveAccount === 'function') {
                        wallet.setActiveAccount(wallet.accounts[0].address)
                      }
                    }
                    closeModal()
                  }}
                >
                  {!isKmd(wallet) && (
                    <img
                      alt={`wallet_icon_${wallet.id}`}
                      src={wallet.metadata.icon}
                      style={{ objectFit: 'contain', width: '30px', height: 'auto' }}
                    />
                  )}
                  <span className="font-medium">
                    {isKmd(wallet) ? 'LocalNet Wallet' : wallet.metadata.name}
                  </span>
                  <span style={{ color: '#009999' }}>→</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-6 mt-6" style={{ borderTop: '1px solid rgba(0, 102, 102, 0.3)' }}>
          <button
            data-test-id="close-wallet-modal"
            className="px-4 py-2 rounded transition-colors"
            style={{
              backgroundColor: 'rgba(68, 68, 68, 0.8)',
              color: '#bbb',
              border: '1px solid rgba(0, 102, 102, 0.3)',
              fontFamily: 'Arial, sans-serif',
              fontSize: '12px'
            }}
            onClick={closeModal}
          >
            Close
          </button>
          {activeAddress && (
            <button
              className="px-4 py-2 rounded transition-colors hover:scale-105"
              style={{
                backgroundColor: 'rgba(233, 87, 87, 0.8)',
                color: 'white',
                border: '1px solid rgba(233, 87, 87, 0.5)',
                fontFamily: 'Arial, sans-serif',
                fontSize: '12px'
              }}
              data-test-id="logout"
              onClick={async () => {
                if (wallets) {
                  const activeWallet = wallets.find((w) => w.isActive)
                  if (activeWallet) {
                    await activeWallet.disconnect()
                  } else {
                    // Required for logout/cleanup of inactive providers
                    // For instance, when you login to localnet wallet and switch network
                    // to testnet/mainnet or vice verse.
                    localStorage.removeItem('@txnlab/use-wallet:v3')
                    window.location.reload()
                  }
                }
              }}
            >
              Logout
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
export default ConnectWallet
