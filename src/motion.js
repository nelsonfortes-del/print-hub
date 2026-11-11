// Small, quick motion with GSAP. Everything here only animates transform and
// opacity, and does nothing when the system asks for reduced motion.
import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

const MOTION_OK = '(prefers-reduced-motion: no-preference)'
const CLEAR = 'opacity,visibility,transform'

// Cards fade up one after another when the list changes (filter, set, sort).
// Only the first 24 are animated; the rest are already there.
export function useCardEntrance(key) {
  const ref = useRef(null)
  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add(MOTION_OK, () => {
      const cards = ref.current ? [...ref.current.children].slice(0, 24) : []
      if (cards.length) gsap.from(cards, { autoAlpha: 0, y: 10, duration: 0.25, ease: 'power2.out', stagger: 0.02, clearProps: CLEAR })
    })
  }, { dependencies: [key], scope: ref })
  return ref
}

// One element eases in when it appears (panel, sheet, toast): pass where it starts from.
export function useEntrance(from, key) {
  const ref = useRef(null)
  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add(MOTION_OK, () => {
      if (ref.current) gsap.from(ref.current, { autoAlpha: 0, duration: 0.22, ease: 'power2.out', ...from, clearProps: CLEAR })
    })
  }, { dependencies: [key], scope: ref })
  return ref
}
