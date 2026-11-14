import { useEffect, useRef, useState } from 'react'

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

/**
 * Canvas w rozmiarze rodzica (CSS px), ostry na HiDPI. Rysuje w requestAnimationFrame
 * tylko gdy zmieni się `draw` (czyli dane) albo rozmiar / devicePixelRatio.
 */
export function useCanvas(draw: DrawFn, height: number) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, dpr: 1 })

  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const update = () => setSize((s) => {
      const w = Math.floor(el.clientWidth)
      const dpr = window.devicePixelRatio || 1
      return s.w === w && s.dpr === dpr ? s : { w, dpr }
    })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || size.w <= 0) return
    const id = requestAnimationFrame(() => {
      const { w, dpr } = size
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, height)
      draw(ctx, w, height)
    })
    return () => cancelAnimationFrame(id)
  }, [draw, size, height])

  return ref
}
