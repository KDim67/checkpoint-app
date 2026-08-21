import { useState, useCallback, useMemo } from 'react'
import { PALETTE_COLORS, hexToRgbFloat } from './types'

/**
 * State and derived snippets for the Shader Palette tool.
 *
 * A hook called from GameDevView rather than state inside PalettePanel: panels
 * unmount on every tab switch, so state held inside one would discard the
 * user's palette the moment they looked at another tool.
 */
export function usePaletteTool() {
  const [paletteColors, setPaletteColors] = useState<string[]>(PALETTE_COLORS)
  const [newColor, setNewColor] = useState('#3b82f6')

  const addColorToPalette = useCallback(() => {
    if (!paletteColors.includes(newColor)) {
      setPaletteColors(prev => [...prev, newColor])
    }
  }, [paletteColors, newColor])

  const removeColorFromPalette = useCallback((col: string) => {
    setPaletteColors(prev => prev.filter(c => c !== col))
  }, [])

  // Recomputed only when the palette changes, not on every unrelated render.
  const generatedUnityColor = useMemo(() =>
    paletteColors.map(c => {
      const { r, g, b } = hexToRgbFloat(c)
      return `new Color(${r}f, ${g}f, ${b}f, 1.0f)`
    }).join(',\n  ')
  , [paletteColors])

  const generatedUnrealColor = useMemo(() =>
    paletteColors.map(c => {
      const { r, g, b } = hexToRgbFloat(c)
      return `FLinearColor(${r}f, ${g}f, ${b}f, 1.0f)`
    }).join(',\n  ')
  , [paletteColors])

  const generatedHlslColor = useMemo(() => {
    const list = paletteColors.map(c => {
      const { r, g, b } = hexToRgbFloat(c)
      return `float4(${r}, ${g}, ${b}, 1.0)`
    }).join(', ')
    return `static const float4 ColorPalette[${paletteColors.length}] = {\n  ${list}\n};`
  }, [paletteColors])

  return {
    paletteColors,
    newColor,
    setNewColor,
    addColorToPalette,
    removeColorFromPalette,
    generatedUnityColor,
    generatedUnrealColor,
    generatedHlslColor
  }
}

export type PaletteTool = ReturnType<typeof usePaletteTool>
