import { useEffect } from 'react'

/**
 * Listens for postMessage events from the legacy iframe and delegates to callbacks.
 */
export function useIframeEvents(
  onOpenWalletModal: () => void,
  onPresetSaved?: (compressedPreset: string) => void,
  onOpenLoadModal?: () => void,
): void {
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (typeof e.data !== 'object' || !e.data) return
      switch (e.data.type) {
        case 'OPEN_WALLET_MODAL':
          onOpenWalletModal()
          break
        case 'PRESET_SAVED':
          console.log('📨 useIframeEvents received PRESET_SAVED:', e.data)
          if (onPresetSaved) onPresetSaved(e.data.preset as string)
          break
        case 'OPEN_LOAD_MODAL':
          console.log('📨 useIframeEvents received OPEN_LOAD_MODAL:', e.data)
          if (onOpenLoadModal) onOpenLoadModal()
          break
        default:
          break
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onOpenWalletModal, onPresetSaved, onOpenLoadModal])
}
