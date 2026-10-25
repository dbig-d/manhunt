// Where the game server lives. Empty means "this same site" (local dev, or everything
// hosted on Cloudflare). The GitHub Pages build sets VITE_API_URL to the Cloudflare
// Worker's address, because GitHub Pages can only host the website itself.
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export const apiUrl = (path: string) => `${API_BASE}${path}`;

export const wsUrl = (path: string) => (API_BASE || location.origin).replace(/^http/, "ws") + path;
