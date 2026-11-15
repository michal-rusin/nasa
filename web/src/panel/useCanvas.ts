import { useEffect, useRef, useState } from 'react'

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

/**
 * Canvas matching its parent size (CSS px), sharp on HiDPI. Draws in requestAnimationFrame
 * only when `draw` (data) or size / devicePixelRatio changes; at most once per
 * frame using the latest `draw` (no cancellation, which previously starved rendering during playback).
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

  const latest = useRef({ draw, size, height })
  const rafId = useRef(0)
  useEffect(() => {
    latest.current = { draw, size, height }
    if (rafId.current) return
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0
      const canvas = ref.current
      const { draw: d, size: { w, dpr }, height: h } = latest.current
      if (!canvas || w <= 0) return
      const cw = Math.round(w * dpr), ch = Math.round(h * dpr)
      if (canvas.width !== cw) canvas.width = cw
      if (canvas.height !== ch) canvas.height = ch
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      d(ctx, w, h)
    })
  }, [draw, size, height])
  useEffect(() => () => { cancelAnimationFrame(rafId.current); rafId.current = 0 }, [])

  return ref
}
