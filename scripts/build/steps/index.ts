import { cleanupOutputDir } from '../../shared/util'
import { addChains } from './addChains'
import { addEvmNetworks } from './addEvmNetworks'
import { addThemeColors } from './addThemeColors'
import { applyNativeTokenOverrides } from './applyNativeTokenOverrides'
import { fixChainEvmNetworkRelations } from './fixChainsEvmNetworkRelations'
import { loadConfig } from './loadConfig'
import { mergeChainsExtras } from './mergeChainsExtras'
import { removeInvalidErc20Tokens } from './removeInvalidErc20Tokens'
import { setTokenLogos } from './setTokenLogos'
import { updateSortIndexes } from './updateSortIndexes'
import { writeChaindataIndex } from './writeChaindataIndex'

export const buildSteps: Array<() => Promise<void>> = [
  cleanupOutputDir,
  loadConfig,

  addChains,
  mergeChainsExtras,

  addEvmNetworks,
  removeInvalidErc20Tokens,
  fixChainEvmNetworkRelations,

  updateSortIndexes,

  applyNativeTokenOverrides,
  setTokenLogos,
  addThemeColors,

  writeChaindataIndex,
]
