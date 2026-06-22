export { DEFAULT_DENYLIST, INFRASTRUCTURE_HEADERS } from './denylist.js';
export { DEFAULT_SECRET_PATTERNS, type SecretPattern } from './secrets.js';
export {
  createScrubber,
  noopScrubber,
  scrubberBrand,
  isNoopScrubber,
} from './scrubber.js';
export { ScrubSpanProcessor, ScrubLogRecordProcessor } from './processors.js';
export type { Scrubber, ScrubberConfig } from '../types/index.js';
