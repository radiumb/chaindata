import { readFile, writeFile } from 'node:fs/promises'

import type { EvmErc20Token } from '@talismn/balances'
import prettier from 'prettier'
import { BaseError, ContractFunctionExecutionError, TimeoutError, getContract, hexToString, parseAbi } from 'viem'

import { cleanupString } from '../../shared/cleanupString'
import {
  FILE_EVM_NETWORKS,
  FILE_KNOWN_EVM_NETWORKS,
  FILE_KNOWN_EVM_TOKENS_CACHE,
  PRETTIER_CONFIG,
} from '../../shared/constants'
import { ConfigEvmNetwork, Erc20TokenCache } from '../../shared/types'
import { erc20Abi } from '../erc20Abi'
import { getEvmNetworkClient } from '../getEvmNetworkClient'

const IGNORED_TOKENS = [
  { chainId: 1, contractAddress: '0x1da4858ad385cc377165a298cc2ce3fce0c5fd31' },
  { chainId: 1, contractAddress: '0xbdeb4b83251fb146687fa19d1c660f99411eefe3' },
  { chainId: 1, contractAddress: '0xc19b6a4ac7c7cc24459f08984bbd09664af17bd1' },
  { chainId: 56, contractAddress: '0x3e3b357061103dc040759ac7dceeaba9901043ad' },
  { chainId: 137, contractAddress: '0x8af78f0c818302164f73b2365fe152c2d1fe80e1' },
  { chainId: 137, contractAddress: '0xf4bb0ed25ac7bcc9c327b88bac5ca288a08ec41e' },
  { chainId: 137, contractAddress: '0xeb99748e91afca94a6289db3b02e7ef4a8f0a22d' },
  { chainId: 295, contractAddress: '0x00000000000000000000000000000000001a88b2' },
  { chainId: 295, contractAddress: '0x000000000000000000000000000000000006f89a' },
  { chainId: 295, contractAddress: '0x00000000000000000000000000000000000b2ad5' },
  { chainId: 295, contractAddress: '0x0000000000000000000000000000000000163b5a' },
  { chainId: 295, contractAddress: '0x00000000000000000000000000000000001647e8' },
  { chainId: 295, contractAddress: '0x000000000000000000000000000000000011afa2' },
  { chainId: 295, contractAddress: '0x0000000000000000000000000000000000101ae3' },
  { chainId: 324, contractAddress: '0x47EF4A5641992A72CFd57b9406c9D9cefEE8e0C4/token-transfers' },
  { chainId: 324, contractAddress: '0x14acccd04393f26ba155e5402aa6fddbb8e2254a for zksync erc-20 tokens' },
  { chainId: 1101, contractAddress: '0x3b6564b5da73a41d3a66e6558a98fd0e9e1e77ad' },
  { chainId: 3693, contractAddress: '0xc84d8d03aa41ef941721a4d77b24bb44d7c7ac55' },
  { chainId: 42161, contractAddress: '0xafa5676a6ef790f08290dd4a45e0ec2a5cc5cdab' },
  { chainId: 42161, contractAddress: '0xedd6ca8a4202d4a36611e2fff109648c4863ae19' },
  { chainId: 42170, contractAddress: '0xb962150760f9a3bb00e3e9cf48297ee20ada4a33' },
]

const isCached = (tokenCache: Erc20TokenCache[], chainId: number, contractAddress: string) =>
  tokenCache.some((t) => t.chainId === chainId && t.contractAddress.toLowerCase() === contractAddress.toLowerCase())

const updateTokenCache = async (
  tokenCache: Erc20TokenCache[],
  evmNetwork: ConfigEvmNetwork,
  contractAddress: string,
) => {
  const chainId = Number(evmNetwork.id)

  if (
    IGNORED_TOKENS.some(
      (t) => t.chainId === chainId && t.contractAddress.toLowerCase() === contractAddress.toLowerCase(),
    )
  )
    return

  if (isCached(tokenCache, chainId, contractAddress)) return

  try {
    const client = getEvmNetworkClient(evmNetwork)
    const contract = getContract({
      address: contractAddress as `0x${string}`,
      abi: erc20Abi,
      publicClient: client,
    })

    let symbol: string
    let decimals: number

    try {
      ;[symbol, decimals] = await Promise.all([contract.read.symbol(), contract.read.decimals()])
    } catch (e) {
      if (e instanceof ContractFunctionExecutionError) {
        // some older tokens have symbol as bytes32, ex 0x0d88ed6e74bbfd96b831231638b66c05571e824f on mainnet
        const erc20BytesAbi = parseAbi([
          'function decimals() view returns (uint8)',
          'function symbol() view returns (bytes32)',
        ] as const)
        const contract = getContract({
          address: contractAddress as `0x${string}`,
          abi: erc20BytesAbi,
          publicClient: client,
        })

        const [symbolBytes, decimals2] = await Promise.all([contract.read.symbol(), contract.read.decimals()])
        decimals = decimals2
        symbol = hexToString(symbolBytes)
      } else {
        throw e
      }
    }

    tokenCache.push({
      chainId,
      contractAddress: contractAddress.toLowerCase(),
      symbol: cleanupString(symbol),
      decimals,
    })
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.warn('Timeout on network:%s ', evmNetwork.name, evmNetwork.id)
      return null
    }
    const viemError = err as BaseError
    console.warn('Failed to fetch token info', {
      network: `${evmNetwork.name} (${evmNetwork.id})`,
      contractAddress,
      err: viemError.shortMessage ?? viemError.message,
    })
  }
}

export const fetchErc20TokenSymbols = async () => {
  const evmNetworks: ConfigEvmNetwork[] = JSON.parse(await readFile(FILE_EVM_NETWORKS, 'utf-8'))
  const knownEvmNetworks: ConfigEvmNetwork[] = JSON.parse(await readFile(FILE_KNOWN_EVM_NETWORKS, 'utf-8'))
  const tokensCache: Erc20TokenCache[] = JSON.parse(await readFile(FILE_KNOWN_EVM_TOKENS_CACHE, 'utf-8'))

  const allNetworks = knownEvmNetworks.concat(evmNetworks)
  const networksById = Object.fromEntries(allNetworks.map((n) => [n.id, n]))

  // need to dedupe tokens that are registered in both knownEvmTokens and evmTokens
  const tokenDefs = new Set<string>()
  for (const network of allNetworks) {
    const tokens = (network.balancesConfig?.['evm-erc20']?.tokens as EvmErc20Token[]) ?? []
    for (const token of tokens) tokenDefs.add(`${network.id}||${token.contractAddress.toLowerCase()}`)
  }

  const promises = Array.from(tokenDefs)
    .map((td) => {
      const [chainId, contractAddress] = td.split('||')
      const network = networksById[chainId]
      return [network, contractAddress] as const
    })
    .map(([network, contractAddress]) => updateTokenCache(tokensCache, network, contractAddress))

  await Promise.all(promises)

  tokensCache.sort((a, b) => {
    if (a.chainId !== b.chainId) return a.chainId - b.chainId
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol)
    return a.contractAddress.localeCompare(b.contractAddress)
  })

  await writeFile(
    FILE_KNOWN_EVM_TOKENS_CACHE,
    await prettier.format(JSON.stringify(tokensCache, null, 2), {
      ...PRETTIER_CONFIG,
      parser: 'json',
    }),
  )
}
