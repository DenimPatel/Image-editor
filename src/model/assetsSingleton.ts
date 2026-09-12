import { AssetStore } from './assets';

/**
 * The single process-wide pixel store. `Doc` references assets by id only, so
 * this is the one owner of live bitmaps for rendering, export and GC.
 */
export const assetStore = new AssetStore();