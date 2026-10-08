/** Theme: 'light' | 'dark'. Stored per browser; falls back to the OS preference. Applied before paint by THEME_SCRIPT. */
export const THEME_KEY = 'seerah:theme'
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`

/** Re-apply the stored (or OS) theme; same logic as THEME_SCRIPT, for use after client-side re-renders of <html>. */
export function applyStoredTheme() {
  let t: string | null = null
  try { t = localStorage.getItem(THEME_KEY) } catch { /* storage blocked */ }
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t
}
