// Browser stand-ins for the few Node APIs the engine uses to load its data file (shareable build only).
import portfolio from '../data/portfolio.json';
export function readFileSync(): string { return JSON.stringify(portfolio); }
export function fileURLToPath(): string { return '/'; }
const path = { join: (...p: string[]) => p.join('/'), dirname: (p: string) => p };
export default path;
