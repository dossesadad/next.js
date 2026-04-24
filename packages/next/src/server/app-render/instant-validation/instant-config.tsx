import { getLayoutOrPageModule } from '../../lib/app-dir-module'
import type { LoaderTree } from '../../lib/app-dir-module'
import { parseLoaderTree } from '../../../shared/lib/router/utils/parse-loader-tree'
import {
  PAGE_SEGMENT_KEY,
  DEFAULT_SEGMENT_KEY,
} from '../../../shared/lib/segment'
import {
  UNDERSCORE_GLOBAL_ERROR_ROUTE,
  UNDERSCORE_NOT_FOUND_ROUTE,
} from '../../../shared/lib/entry-constants'
import type { Segment } from '../../../shared/lib/app-router-types'
import type {
  AppSegmentConfig,
  InstantSample,
} from '../../../build/segment-config/app/app-segment-config'
import {
  workAsyncStorage,
  type WorkStore,
} from '../work-async-storage.external'
import { InvariantError } from '../../../shared/lib/invariant-error'

/**
 * True when an unconfigured segment should be treated as implicitly
 * validated under a non-disabled default validation level. Only page and
 * default segments qualify — layouts do not validate on their own.
 */
export function isImplicitValidationSegment(segment: Segment): boolean {
  const key = typeof segment === 'string' ? segment : segment[0]
  return (
    key === PAGE_SEGMENT_KEY ||
    key.startsWith(PAGE_SEGMENT_KEY) ||
    key === DEFAULT_SEGMENT_KEY
  )
}

/**
 * Routes for the framework-synthesized error and not-found entries. They
 * have no user-configurable escape hatch (the framework supplies the page
 * when the user hasn't), so they're excluded from implicit validation under
 * a non-disabled default validation level. Even when the user provides their
 * own `global-error` or root `not-found`, these pages are special-purpose
 * error UI — opting them into validation is something the user can do
 * explicitly via `unstable_instant`.
 */
export function isFrameworkErrorRoute(route: string | undefined): boolean {
  return (
    route === UNDERSCORE_GLOBAL_ERROR_ROUTE ||
    route === UNDERSCORE_NOT_FOUND_ROUTE
  )
}

export async function anySegmentHasRuntimePrefetchEnabled(
  tree: LoaderTree
): Promise<boolean> {
  const { mod: layoutOrPageMod } = await getLayoutOrPageModule(tree)

  // TODO(restart-on-cache-miss): Does this work correctly for client page/layout modules?
  const prefetchConfig = layoutOrPageMod
    ? (layoutOrPageMod as AppSegmentConfig).unstable_prefetch
    : undefined
  if (prefetchConfig === 'force-runtime') {
    return true
  }

  const { parallelRoutes } = parseLoaderTree(tree)
  for (const parallelRouteKey in parallelRoutes) {
    const parallelRoute = parallelRoutes[parallelRouteKey]
    const hasChildRuntimePrefetch =
      await anySegmentHasRuntimePrefetchEnabled(parallelRoute)
    if (hasChildRuntimePrefetch) {
      return true
    }
  }

  return false
}

export async function isPageAllowedToBlock(tree: LoaderTree): Promise<boolean> {
  const { mod: layoutOrPageMod } = await getLayoutOrPageModule(tree)

  // TODO(restart-on-cache-miss): Does this work correctly for client page/layout modules?
  const instantConfig = layoutOrPageMod
    ? (layoutOrPageMod as AppSegmentConfig).unstable_instant
    : undefined

  // If we encounter a non-false instant config before a instant=false,
  // the page isn't allowed to block. The config expresses a requirement for
  // instant UI, so we should make sure that a static shell exists.
  // (even if it'd use runtime prefetching for client navs)
  if (instantConfig !== undefined) {
    if (instantConfig === false) {
      return true
    } else {
      return false
    }
  }

  const { parallelRoutes } = parseLoaderTree(tree)
  for (const parallelRouteKey in parallelRoutes) {
    const parallelRoute = parallelRoutes[parallelRouteKey]
    const subtreeIsBlocking = await isPageAllowedToBlock(parallelRoute)
    if (subtreeIsBlocking) {
      return true
    }
  }

  return false
}

/**
 * Walks the loader tree and checks if any segment has an `instant` config
 * that needs validating for the given mode.
 *
 * - Explicit `unstable_instant` exports are checked against mode.
 * - Page and default segments without an explicit config get implicit
 *   validation when the default validation level applies to this mode.
 * - `unstable_disableValidation` on any segment kills validation for
 *   the whole tree.
 */
async function anySegmentNeedsInstantValidation(
  rootTree: LoaderTree,
  mode: 'dev' | 'build'
): Promise<boolean> {
  const workStore = workAsyncStorage.getStore()
  if (!workStore) {
    throw new InvariantError(
      'anySegmentNeedsInstantValidation must run inside a WorkStore'
    )
  }
  const { defaultValidationLevel } = workStore

  // The effective level for configs that opt in without specifying one
  // (`unstable_instant = true` or an object without `level`). When the
  // default is disabled, an explicit opt-in still means something, so we
  // fall back to `'warning'`.
  const defaultEffectiveLevel: 'warning' | 'error' =
    defaultValidationLevel === 'disabled' ? 'warning' : defaultValidationLevel
  // True when the default level applies to this mode, meaning unconfigured
  // page/default segments should be treated as implicitly validated.
  // Framework-synthesized error routes are excluded — see isFrameworkErrorRoute.
  const defaultLevelAppliesToMode =
    defaultValidationLevel !== 'disabled' &&
    (mode === 'dev' || defaultEffectiveLevel === 'error') &&
    !isFrameworkErrorRoute(workStore.route)

  let needsValidation = false
  let disabled = false

  async function visit(tree: LoaderTree): Promise<void> {
    if (disabled) return

    const { mod: layoutOrPageMod } = await getLayoutOrPageModule(tree)
    const instantConfig = layoutOrPageMod
      ? (layoutOrPageMod as AppSegmentConfig).unstable_instant
      : undefined

    if (instantConfig === false) {
      // Explicit opt-out. Doesn't itself trigger validation.
    } else if (instantConfig === true) {
      // Explicit opt-in using the default level.
      if (mode === 'dev' || defaultEffectiveLevel === 'error') {
        needsValidation = true
      }
    } else if (typeof instantConfig === 'object' && instantConfig !== null) {
      if (
        instantConfig.unstable_disableValidation === true ||
        (mode === 'dev' &&
          instantConfig.unstable_disableDevValidation === true) ||
        (mode === 'build' &&
          instantConfig.unstable_disableBuildValidation === true)
      ) {
        disabled = true
        return
      }

      if (instantConfig.level !== undefined) {
        if (mode === 'dev' || instantConfig.level === 'error') {
          needsValidation = true
        }
      } else if (mode === 'dev' || defaultEffectiveLevel === 'error') {
        needsValidation = true
      }
    } else if (
      defaultLevelAppliesToMode &&
      isImplicitValidationSegment(tree[0])
    ) {
      // No explicit config. Implicit validation applies to page/default
      // segments when the default level is active for this mode.
      needsValidation = true
    }

    const { parallelRoutes } = parseLoaderTree(tree)
    for (const parallelRouteKey in parallelRoutes) {
      await visit(parallelRoutes[parallelRouteKey])
      if (disabled) return
    }
  }

  await visit(rootTree)
  if (disabled) {
    return false
  }
  return needsValidation
}

export const anySegmentNeedsInstantValidationInDev = cacheScopedToWorkStore(
  async (rootTree: LoaderTree): Promise<boolean> =>
    anySegmentNeedsInstantValidation(rootTree, 'dev')
)

export const anySegmentNeedsInstantValidationInBuild = cacheScopedToWorkStore(
  async (rootTree: LoaderTree): Promise<boolean> =>
    anySegmentNeedsInstantValidation(rootTree, 'build')
)

export const resolveInstantConfigSamplesForPage = async (
  tree: LoaderTree
): Promise<InstantSample[] | null> => {
  const { mod: layoutOrPageMod } = await getLayoutOrPageModule(tree)

  const instantConfig = layoutOrPageMod
    ? (layoutOrPageMod as AppSegmentConfig).unstable_instant
    : undefined

  let samples: InstantSample[] | null = null
  if (
    instantConfig !== undefined &&
    typeof instantConfig === 'object' &&
    instantConfig.samples
  ) {
    samples = instantConfig.samples
  }

  // The samples from inner segments override samples from outer segments,
  // i.e. a page overrides the samples from a layout.
  // We do not perform any merging logic.
  const { parallelRoutes } = parseLoaderTree(tree)
  for (const parallelRouteKey in parallelRoutes) {
    if (parallelRouteKey !== 'children') {
      // TODO(instant-validation-build): do something with with samples from non-children slots?
      continue
    }
    const childTree = parallelRoutes[parallelRouteKey]
    const childSamples = await resolveInstantConfigSamplesForPage(childTree)
    if (childSamples !== null) {
      samples = childSamples
    }
  }

  return samples
}

/**
 * A simple cache wrapper for 1-argument functions.
 * The cache will live as long as the current WorkStore,
 * i.e. it's scoped to a single request.
 */
function cacheScopedToWorkStore<TArg extends WeakKey, TRes>(
  func: (arg: TArg) => TRes
): (arg: TArg) => TRes {
  const resultsPerWorkStore = new WeakMap<WorkStore, WeakMap<TArg, TRes>>()
  return (arg: TArg): TRes => {
    const workStore = workAsyncStorage.getStore()
    if (!workStore) {
      throw new InvariantError(
        `${func.name || 'cacheScopedToWorkStore callee'} must run inside a WorkStore`
      )
    }

    let results = resultsPerWorkStore.get(workStore)
    if (results && results.has(arg)) {
      return results.get(arg)!
    }

    const result = func(arg)

    if (!results) {
      results = new WeakMap()
      resultsPerWorkStore.set(workStore, results)
    }
    results.set(arg, result)

    return result
  }
}
