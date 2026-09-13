import React, { useEffect, useState } from 'react'
import { Copy, Download, Check } from 'lucide-react'
import { useToast } from './Toast'
import useEscapeKey from './useEscapeKey'
import useFocusTrap from './useFocusTrap'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'

interface LightboxProps {
  src: string | null
  onClose: () => void
}

export default function Lightbox({ src, onClose }: LightboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setIsOpen(src !== null)
  }, [src])

  useEscapeKey(onClose, src !== null)
  const containerRef = useFocusTrap(src !== null)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!src) return
    try {
      const response = await fetch(src)
      const blob = await response.blob()

      // the clipboard API needs a ClipboardItem
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
      toast('Copied image to clipboard')
    } catch (err) {
      console.error('[Lightbox] Failed to copy image:', err)
      toast('Failed to copy image to clipboard')
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!src) return
    try {
      const response = await fetch(src)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = url
      // filename or fallback
      const filename = src.split('/').pop() || 'image.png'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast('Saved image successfully')
    } catch (err) {
      console.error('[Lightbox] Failed to download image:', err)
      toast('Failed to download image')
    }
  }

  if (!src) return null

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        background: 'rgba(7, 8, 10, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isOpen ? 1 : 0,
        transition: 'opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'zoom-out'
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close preview"
        className="lightbox-close hover-border-accent hover-grow"
        style={{
          position: 'absolute',
          top: '48px',
          right: '24px',
          borderRadius: '50%',
          width: '44px',
          height: '44px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all var(--duration-fast) var(--ease-default)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 100000
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div
        onClick={e => e.stopPropagation()} // don't close when clicking the image
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-4)',
          transform: isOpen ? 'scale(1)' : 'scale(0.95)',
          transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
          cursor: 'default'
        }}
      >
        <img
          src={src}
          alt="Preview"
          style={{
            maxWidth: '100%',
            maxHeight: '75vh',
            objectFit: 'contain',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.8)',
            border: '1px solid var(--color-surface-offset)'
          }}
        />

        {/* floating toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            background: 'var(--color-surface-1)',
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-surface-offset)',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          <button
            onClick={handleCopy}
            title="Copy image to clipboard"
            className="text-muted hover-text-accent"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1.5)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              transition: 'all var(--duration-fast)',
              outline: 'none'
            }}
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>

          <div style={{ width: '1px', height: '14px', background: 'var(--color-surface-offset)' }} />

          <button
            onClick={handleDownload}
            title="Save image to disk"
            className="text-muted hover-text-accent"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1.5)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              transition: 'all var(--duration-fast)',
              outline: 'none'
            }}
          >
            <Download size={14} />
            Download
          </button>

          <div style={{ width: '1px', height: '14px', background: 'var(--color-surface-offset)' }} />

          <span
            style={{
              color: 'var(--color-text-faint)',
              fontSize: 'var(--text-xs)',
              userSelect: 'none'
            }}
          >
            ESC to close
          </span>
        </div>
      </div>
    </div>
  )
}
