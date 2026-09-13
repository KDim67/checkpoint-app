import { useState, type ChangeEvent } from 'react'
import { useToast } from '../ui/Toast'

/** on the board, not the menu: the menu unmounts on reload and would drop an unfinished gradient */
export function useBoardTheme() {
  const { toast } = useToast()
  const [boardBg, setBoardBg] = useState<string>('default')
  const [customBgTab, setCustomBgTab] = useState<'presets' | 'solid' | 'gradient' | 'image'>('presets')
  const [customSolidColor, setCustomSolidColor] = useState('#1e293b')
  const [customGradStart, setCustomGradStart] = useState('#1e3c72')
  const [customGradEnd, setCustomGradEnd] = useState('#2a5298')
  const [customGradAngle, setCustomGradAngle] = useState<number>(135)
  const [customGradType, setCustomGradType] = useState<'linear' | 'radial'>('linear')
  const [customImageUrl, setCustomImageUrl] = useState('')
  const [showBgSelector, setShowBgSelector] = useState(false)

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      toast('Image is too large (max 8MB)', { type: 'error' })
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      if (dataUrl) {
        setCustomImageUrl(dataUrl)
      }
    }
    reader.readAsDataURL(file)
  }

  return {
    boardBg,
    setBoardBg,
    customBgTab,
    setCustomBgTab,
    customSolidColor,
    setCustomSolidColor,
    customGradStart,
    setCustomGradStart,
    customGradEnd,
    setCustomGradEnd,
    customGradAngle,
    setCustomGradAngle,
    customGradType,
    setCustomGradType,
    customImageUrl,
    setCustomImageUrl,
    showBgSelector,
    setShowBgSelector,
    handleFileUpload
  }
}

export type BoardTheme = ReturnType<typeof useBoardTheme>
