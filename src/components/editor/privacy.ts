import { MODELS } from '../../features/ml/ModelLoader'

/**
 * What this app fetches from somebody else, and when.
 *
 * It lives in its own module rather than beside either component that renders it
 * because both of them do: the import screen shows it to somebody deciding
 * whether to open their photo at all, and the first-run orientation repeats it
 * to somebody who has not read the import screen. One copy on disk is the point
 * — two wordings of a privacy disclosure is one wording too many, and the one
 * nobody maintains is the one that ends up reassuring people.
 */

const MEGABYTE = 1024 * 1024

/**
 * The matting model sizes, in MB, derived from the catalogue rather than
 * written down.
 *
 * The number is the whole point of the disclosure: "about 42 MB" that is really
 * a copy of another sentence is a number that goes stale the next time the
 * measured download changes, and a stale privacy figure is worse than none,
 * because it is still believed. `MODELS` is where the weights are measured from
 * and `BackgroundPanel` renders the same two entries, so this cannot disagree
 * with the panel behind the button that causes the download.
 */
export const mattingMegabytes = {
  fast: Math.round(MODELS['matting-quint8'].bytes / MEGABYTE),
  best: Math.round(MODELS['matting-fp16'].bytes / MEGABYTE),
}

/**
 * The privacy claim and its exception, as one sentence.
 *
 * The claim "your images never leave this tab" is true and incomplete: a CDN
 * fetch is not an upload, but it does tell a third party this visitor's IP
 * address, user agent and origin, and it happens on a button the user chose to
 * press. So the caveat sits inside the claim rather than under it, where a
 * privacy-conscious reader deciding whether to trust this app with a photo will
 * actually meet it. The previous disclosure was a hint line inside the
 * Background panel — behind the button that causes the download, which is after
 * the decision.
 *
 * The last sentence is load-bearing in the other direction. "Nothing leaves this
 * tab" and "nothing is downloaded from anyone" are different claims, and only
 * the second is unconditionally true: this page, the samples and the fonts are
 * all fetched from somewhere. Saying so is what lets the first sentence stand.
 */
export function cdnDisclosure(): string {
  return `Nothing is uploaded, and the file on your disk is never written to — but Remove Background is not local: the first time you use it, it fetches about ${mattingMegabytes.fast} MB of model from the imgly CDN (${mattingMegabytes.best} MB for best quality), and that CDN sees your IP address and browser. If you never use that tool, nothing is downloaded from anyone at all.`
}
