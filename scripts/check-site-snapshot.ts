import { verifySnapshot } from './site-snapshot.ts';

const files = await verifySnapshot();
console.log(`Verified ${files.length} pinned site files before build`);
