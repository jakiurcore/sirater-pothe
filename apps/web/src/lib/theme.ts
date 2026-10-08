/** Theme: 'light' | 'dark'. Stored per browser; falls back to the OS preference. Applied before paint by THEME_SCRIPT. */
export const THEME_KEY = 'seerah:theme'
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`
