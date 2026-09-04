import { useState, useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useToast } from '../ui/Toast'
import { useAppStore } from '../../store/appStore'
import { computePbrMaps } from '../../lib/imageProcessing'
import { errorMessage } from '../../../../shared/errors'

/**
 * PBR Map Generator: albedo intake, height/normal/roughness/AO derivation, the
 * three.js material preview, and export.
 *
 * isActive gates the canvas and WebGL work so it only runs while the tool is on
 * screen; the preview renderer is torn down when it goes false. Reads the
 * Kanban hand-off path from the store and asks the parent to switch tabs, so
 * the hand-off lands even from another tool.
 */
export function usePbrTool(isActive: boolean, onActivate: () => void) {
  const { toast } = useToast()

  // Tab 5: PBR Map Generator State
  const preloadTexturePath = useAppStore(state => state.gamedevPreloadTexturePath)
  const preloadCardId = useAppStore(state => state.gamedevSourceCardId)

  const [albedoPath, setAlbedoPath] = useState<string | null>(null)
  const [albedoUrl, setAlbedoUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [exportedFiles, setExportedFiles] = useState<string[]>([])
  const [shape, setShape] = useState<'sphere' | 'cube' | 'plane'>('sphere')
  const [rotate, setRotate] = useState(true)

  // Sliders
  const [normalIntensity, setNormalIntensity] = useState(2.5)
  const [heightDepth, setHeightDepth] = useState(1.0)
  const [roughnessContrast, setRoughnessContrast] = useState(1.0)
  const [roughnessBase, setRoughnessBase] = useState(0.5)
  const [aoIntensity, setAoIntensity] = useState(1.0)
  const [invertHeight, setInvertHeight] = useState(false)

  // Canvases
  const albedoCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const heightCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const normalCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const roughnessCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const aoCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Image Ref
  const originalImageRef = useRef<HTMLImageElement | null>(null)


  // PBR Map Generator Functions
  const loadTexturePath = useCallback(async (path: string) => {
    setIsProcessing(true)
    try {
      const res = await window.electronAPI.gamedev.loadTexture(path)
      if (res) {
        setAlbedoPath(res.path)
        setAlbedoUrl(res.dataUrl)
        setExportedFiles([])
      } else {
        toast('Failed to load preloaded texture file.', { type: 'error' })
      }
    } catch (err) {
      console.error(err)
      toast('Error loading preloaded texture.', { type: 'error' })
    } finally {
      setIsProcessing(false)
    }
  }, [toast])

  const handlePbrDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handlePbrDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files.length === 0) return

    const file = files[0]
    if (!file.type.startsWith('image/')) {
      toast('Invalid File: Please drop an image file.', { type: 'error' })
      return
    }

    setIsProcessing(true)
    try {
      // Electron ≥32: File.path no longer exists. Resolve via preload webUtils
      const path = window.electronAPI.app.getPathForFile(file)
      const reader = new FileReader()
      reader.onload = (event) => {
        setAlbedoPath(path)
        setAlbedoUrl(event.target?.result as string)
        setExportedFiles([])
        setIsProcessing(false)
      }
      reader.readAsDataURL(file)
    } catch (err) {
      console.error(err)
      toast('Failed to read dropped file.', { type: 'error' })
      setIsProcessing(false)
    }
  }, [toast])

  const handleBrowseClick = useCallback(async () => {
    setIsProcessing(true)
    try {
      const res = await window.electronAPI.gamedev.selectTexture()
      if (res) {
        setAlbedoPath(res.path)
        setAlbedoUrl(res.dataUrl)
        setExportedFiles([])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }, [])

  // Sobel-based real-time 2D pixel calculations. Delegates to shared computePbrMaps()
  const processTextures = useCallback(() => {
    const img = originalImageRef.current
    if (!img) return

    const size = 512
    const offCanvas = document.createElement('canvas')
    offCanvas.width = size
    offCanvas.height = size
    const offCtx = offCanvas.getContext('2d')
    if (!offCtx) return
    offCtx.drawImage(img, 0, 0, size, size)
    const src = offCtx.getImageData(0, 0, size, size).data

    const heightCanvas = heightCanvasRef.current
    const normalCanvas = normalCanvasRef.current
    const roughnessCanvas = roughnessCanvasRef.current
    const aoCanvas = aoCanvasRef.current
    if (!heightCanvas || !normalCanvas || !roughnessCanvas || !aoCanvas) return

    const heightCtx = heightCanvas.getContext('2d')
    const normalCtx = normalCanvas.getContext('2d')
    const roughnessCtx = roughnessCanvas.getContext('2d')
    const aoCtx = aoCanvas.getContext('2d')
    if (!heightCtx || !normalCtx || !roughnessCtx || !aoCtx) return

    const { hData, nData, rData, aData } = computePbrMaps(src, size, size, {
      normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight
    })

    heightCtx.putImageData(new ImageData(hData, size, size), 0, 0)
    normalCtx.putImageData(new ImageData(nData, size, size), 0, 0)
    roughnessCtx.putImageData(new ImageData(rData, size, size), 0, 0)
    aoCtx.putImageData(new ImageData(aData, size, size), 0, 0)

    if (threeTexturesRef.current.map) threeTexturesRef.current.map.needsUpdate = true
    if (threeTexturesRef.current.normalMap) threeTexturesRef.current.normalMap.needsUpdate = true
    if (threeTexturesRef.current.bumpMap) threeTexturesRef.current.bumpMap.needsUpdate = true
    if (threeTexturesRef.current.roughnessMap) threeTexturesRef.current.roughnessMap.needsUpdate = true
    if (threeTexturesRef.current.aoMap) threeTexturesRef.current.aoMap.needsUpdate = true
  }, [normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight])

  // Full-resolution export. Also delegates to computePbrMaps() for identical output
  const handleExport = useCallback(async () => {
    const img = originalImageRef.current
    if (!img || !albedoPath) return
    setIsSaving(true)

    try {
      const W = img.width
      const H = img.height

      const offCanvas = document.createElement('canvas')
      offCanvas.width = W
      offCanvas.height = H
      const offCtx = offCanvas.getContext('2d')
      if (!offCtx) throw new Error('Could not create canvas context')
      offCtx.drawImage(img, 0, 0)
      const src = offCtx.getImageData(0, 0, W, H).data

      const { hData, nData, rData, aData } = computePbrMaps(src, W, H, {
        normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight
      })

      // Convert each typed array to a data URL via an off-screen canvas
      const toDataUrl = (data: Uint8ClampedArray<ArrayBuffer>) => {
        const c = document.createElement('canvas')
        c.width = W; c.height = H
        c.getContext('2d')!.putImageData(new ImageData(data, W, H), 0, 0)
        return c.toDataURL('image/png')
      }

      const maps = {
        normal:    toDataUrl(nData),
        height:    toDataUrl(hData),
        roughness: toDataUrl(rData),
        ao:        toDataUrl(aData)
      }

      const res = await window.electronAPI.gamedev.saveMaps({ albedoPath, maps })
      if (res.success) {
        toast('PBR maps exported next to original Albedo texture!', { type: 'success' })
        setExportedFiles(res.writtenFiles)
      } else {
        throw new Error(res.error || 'Failed to save maps')
      }
    } catch (err) {
      console.error(err)
      toast('Export Error: ' + (errorMessage(err)), { type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }, [albedoPath, normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, invertHeight, toast])

  // Watch preload texture path from appStore
  useEffect(() => {
    if (preloadTexturePath) {
      onActivate()
      loadTexturePath(preloadTexturePath)
    }
  }, [preloadTexturePath, loadTexturePath])

  // Watch albedo dataUrl changes and draw into canvases
  useEffect(() => {
    if (!albedoUrl) return

    const img = new Image()
    img.onload = () => {
      originalImageRef.current = img
      const size = 512

      const canvases = [
        albedoCanvasRef.current,
        heightCanvasRef.current,
        normalCanvasRef.current,
        roughnessCanvasRef.current,
        aoCanvasRef.current
      ]

      canvases.forEach(canvas => {
        if (canvas) {
          canvas.width = size
          canvas.height = size
        }
      })

      const albedoCanvas = albedoCanvasRef.current
      if (albedoCanvas) {
        const ctx = albedoCanvas.getContext('2d')
        if (ctx) ctx.drawImage(img, 0, 0, size, size)
      }

      processTextures()
    }
    img.src = albedoUrl
  }, [albedoUrl, processTextures])

  // Triggers processTextures when sliders change or activeTab switches to PBR
  useEffect(() => {
    if (isActive && albedoUrl) {
      if (originalImageRef.current) {
        const size = 512
        const canvases = [
          albedoCanvasRef.current,
          heightCanvasRef.current,
          normalCanvasRef.current,
          roughnessCanvasRef.current,
          aoCanvasRef.current
        ]
        canvases.forEach(canvas => {
          if (canvas) {
            canvas.width = size
            canvas.height = size
          }
        })
        const albedoCanvas = albedoCanvasRef.current
        if (albedoCanvas) {
          const ctx = albedoCanvas.getContext('2d')
          if (ctx) ctx.drawImage(originalImageRef.current, 0, 0, size, size)
        }
      }
      processTextures()
    }
  }, [normalIntensity, heightDepth, roughnessContrast, roughnessBase, aoIntensity, albedoUrl, isActive, processTextures])

  // ThreeJS texture refs
  const threeTexturesRef = useRef<{
    map: THREE.CanvasTexture | null;
    normalMap: THREE.CanvasTexture | null;
    bumpMap: THREE.CanvasTexture | null;
    roughnessMap: THREE.CanvasTexture | null;
    aoMap: THREE.CanvasTexture | null;
  }>({
    map: null,
    normalMap: null,
    bumpMap: null,
    roughnessMap: null,
    aoMap: null
  })

  const threeSceneRef = useRef<{
    renderer: THREE.WebGLRenderer | null;
    mesh: THREE.Mesh | null;
    material: THREE.MeshStandardMaterial | null;
  }>({
    renderer: null,
    mesh: null,
    material: null
  })

  // ThreeJS initialization and loop
  useEffect(() => {
    if (!isActive) return
    const canvas = previewCanvasRef.current
    if (!canvas) return

    const width = 328
    const height = 300

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    camera.position.z = 2.4

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    threeSceneRef.current.renderer = renderer

    const albedoCanvas = albedoCanvasRef.current
    const heightCanvas = heightCanvasRef.current
    const normalCanvas = normalCanvasRef.current
    const roughnessCanvas = roughnessCanvasRef.current
    const aoCanvas = aoCanvasRef.current

    let map: THREE.CanvasTexture | null = null
    let normalMap: THREE.CanvasTexture | null = null
    let bumpMap: THREE.CanvasTexture | null = null
    let roughnessMap: THREE.CanvasTexture | null = null
    let aoMap: THREE.CanvasTexture | null = null

    if (albedoCanvas) {
      map = new THREE.CanvasTexture(albedoCanvas)
      threeTexturesRef.current.map = map
    }
    if (normalCanvas) {
      normalMap = new THREE.CanvasTexture(normalCanvas)
      threeTexturesRef.current.normalMap = normalMap
    }
    if (heightCanvas) {
      bumpMap = new THREE.CanvasTexture(heightCanvas)
      threeTexturesRef.current.bumpMap = bumpMap
    }
    if (roughnessCanvas) {
      roughnessMap = new THREE.CanvasTexture(roughnessCanvas)
      threeTexturesRef.current.roughnessMap = roughnessMap
    }
    if (aoCanvas) {
      aoMap = new THREE.CanvasTexture(aoCanvas)
      threeTexturesRef.current.aoMap = aoMap
    }

    const material = new THREE.MeshStandardMaterial({
      map: map,
      normalMap: normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      bumpMap: bumpMap,
      bumpScale: 0.08,
      roughnessMap: roughnessMap,
      aoMap: aoMap,
      metalness: 0.05,
      side: THREE.DoubleSide // keeps the plane visible from behind while rotating
    })
    threeSceneRef.current.material = material

    let geometry: THREE.BufferGeometry
    if (shape === 'cube') {
      geometry = new THREE.BoxGeometry(0.9, 0.9, 0.9)
    } else if (shape === 'plane') {
      geometry = new THREE.PlaneGeometry(1.35, 1.35)
    } else {
      geometry = new THREE.SphereGeometry(0.65, 64, 64)
    }

    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    threeSceneRef.current.mesh = mesh

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambientLight)

    const pointLight = new THREE.PointLight(0xffffff, 1.8, 100)
    pointLight.position.set(2, 2, 2)
    scene.add(pointLight)

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6)
    dirLight.position.set(-2, 1, 2)
    scene.add(dirLight)

    let animationFrameId: number
    let angle = 0

    const animate = () => {
      if (rotate) {
        mesh.rotation.y += 0.005
        mesh.rotation.x += 0.002
      }

      angle += 0.015
      pointLight.position.x = Math.cos(angle) * 2
      pointLight.position.z = Math.sin(angle) * 2

      renderer.render(scene, camera)
      animationFrameId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationFrameId)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      if (map) map.dispose()
      if (normalMap) normalMap.dispose()
      if (bumpMap) bumpMap.dispose()
      if (roughnessMap) roughnessMap.dispose()
      if (aoMap) aoMap.dispose()

      threeTexturesRef.current = {
        map: null,
        normalMap: null,
        bumpMap: null,
        roughnessMap: null,
        aoMap: null
      }
      threeSceneRef.current = {
        renderer: null,
        mesh: null,
        material: null
      }
    }
  }, [isActive, shape, rotate])

  return {
    setAlbedoPath,
    setAlbedoUrl,
    setExportedFiles,
    preloadCardId,
    albedoPath,
    albedoUrl,
    isProcessing,
    isSaving,
    exportedFiles,
    shape,
    setShape,
    rotate,
    setRotate,
    normalIntensity,
    setNormalIntensity,
    heightDepth,
    setHeightDepth,
    roughnessContrast,
    setRoughnessContrast,
    roughnessBase,
    setRoughnessBase,
    aoIntensity,
    setAoIntensity,
    invertHeight,
    setInvertHeight,
    albedoCanvasRef,
    heightCanvasRef,
    normalCanvasRef,
    roughnessCanvasRef,
    aoCanvasRef,
    previewCanvasRef,
    handlePbrDragOver,
    handlePbrDrop,
    handleBrowseClick,
    handleExport
  }
}

export type PbrTool = ReturnType<typeof usePbrTool>
