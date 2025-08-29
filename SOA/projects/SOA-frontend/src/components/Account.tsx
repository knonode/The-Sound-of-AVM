import { useWallet } from '@txnlab/use-wallet-react'
import { useMemo } from 'react'
import { ellipseAddress } from '../utils/ellipseAddress'
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'

const Account = () => {
  const { activeAddress } = useWallet()
  const algoConfig = getAlgodConfigFromViteEnvironment()

  const networkName = useMemo(() => {
    return algoConfig.network === '' ? 'localnet' : algoConfig.network.toLocaleLowerCase()
  }, [algoConfig.network])

  return (
    <div>
      <a
        className="text-xl text-white cursor-pointer underline hover:text-gray-300"
        onClick={() => {
          try {
            // attempt to set active address when clicked
            const walletCtx: any = require('@txnlab/use-wallet-react').useWallet?.() ?? {}
            if (walletCtx.setActiveAddress) walletCtx.setActiveAddress(activeAddress)
          } catch {}
          window.open(`https://lora.algokit.io/${networkName}/account/${activeAddress}/`, '_blank')
        }}
      >
        Address: {ellipseAddress(activeAddress)}
      </a>
      <div className="text-xl text-white">Network: {networkName}</div>
    </div>
  )
}

export default Account
