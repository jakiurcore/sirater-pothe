'use client'
import { useEffect } from 'react'
import { applyStoredTheme } from '@/lib/theme'
import { useFmt } from './Providers'

/**
 * Switching language re-renders the root layout (different <html lang/dir>), and React then rebuilds <html> without
 * the data-theme the init script set. Re-apply it whenever the language changes.
 */
export function ThemeSync() {
  const { lang } = useFmt()
  useEffect(() => { applyStoredTheme() }, [lang])
  return null
}
