<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { usePrefersReducedMotion } from '../../composables/usePrefersReducedMotion'

gsap.registerPlugin(ScrollTrigger)

const canvasHost = ref<HTMLDivElement | null>(null)
const prefersReducedMotion = usePrefersReducedMotion()

const VOLT = 0xcbff3e
const EMBER = 0xff7a45
const NODE_COUNT = 26
const CONNECT_DISTANCE = 2.3
const PULSE_COUNT = 7

let renderer: THREE.WebGLRenderer | null = null
let observer: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let scrollTrigger: ScrollTrigger | null = null
let frameId = 0
let isVisible = true
let scrollProgress = 0
let smoothedScroll = 0

onMounted(() => {
  const host = canvasHost.value
  if (!host) return

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  camera.position.set(0, 0, 7.2)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.appendChild(renderer.domElement)

  const group = new THREE.Group()
  scene.add(group)

  // Fibonacci-sphere distribution: an even, organic-looking node network
  // rather than a rigid grid — reads as "mesh", not "spreadsheet".
  const points: THREE.Vector3[] = []
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < NODE_COUNT; i++) {
    const y = 1 - (i / (NODE_COUNT - 1)) * 2
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = goldenAngle * i
    points.push(
      new THREE.Vector3(Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY).multiplyScalar(2.6),
    )
  }

  const hostNodeIndices = new Set<number>()
  points.forEach((_, i) => {
    if (i % 4 === 1) hostNodeIndices.add(i)
  })

  const nodeGeometry = new THREE.IcosahedronGeometry(0.052, 1)
  points.forEach((point, i) => {
    const isHost = hostNodeIndices.has(i)
    const material = new THREE.MeshBasicMaterial({ color: isHost ? EMBER : VOLT })
    const mesh = new THREE.Mesh(nodeGeometry, material)
    mesh.position.copy(point)
    group.add(mesh)
  })

  // Edges between nearby nodes
  const edgePositions: number[] = []
  const edges: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[i].distanceTo(points[j]) < CONNECT_DISTANCE) {
        edges.push([i, j])
        edgePositions.push(points[i].x, points[i].y, points[i].z, points[j].x, points[j].y, points[j].z)
      }
    }
  }
  const edgeGeometry = new THREE.BufferGeometry()
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
  const edgeMaterial = new THREE.LineBasicMaterial({ color: VOLT, transparent: true, opacity: 0.24 })
  group.add(new THREE.LineSegments(edgeGeometry, edgeMaterial))

  // Pulses: small glowing points that travel along a random edge, standing
  // in for a reservation / energy dispatch moving across the network.
  const pulseGeometry = new THREE.SphereGeometry(0.03, 8, 8)
  const pulses = Array.from({ length: PULSE_COUNT }, () => {
    const material = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.7 ? EMBER : VOLT,
      transparent: true,
    })
    const mesh = new THREE.Mesh(pulseGeometry, material)
    group.add(mesh)
    return {
      mesh,
      edge: edges[Math.floor(Math.random() * edges.length)],
      t: Math.random(),
      speed: 0.12 + Math.random() * 0.18,
    }
  })

  const resize = () => {
    if (!renderer) return
    const { clientWidth, clientHeight } = host
    renderer.setSize(clientWidth, clientHeight)
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
  }
  resize()

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(host)

  observer = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting
  })
  observer.observe(host)

  const timer = new THREE.Timer()

  const renderStaticFrame = () => {
    group.rotation.set(0.15, -0.4, 0)
    renderer?.render(scene, camera)
  }

  if (prefersReducedMotion.value) {
    renderStaticFrame()
  } else {
    // Ties the mesh's orientation and camera distance to how far the hero
    // has scrolled past — the network "settles" into a new view rather than
    // just looping in place, so it reads as directed, not decorative.
    scrollTrigger = ScrollTrigger.create({
      trigger: host,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => {
        scrollProgress = self.progress
      },
    })

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      if (!isVisible || document.hidden || !renderer) return

      timer.update()
      const delta = timer.getDelta()
      smoothedScroll += (scrollProgress - smoothedScroll) * Math.min(delta * 4, 1)

      group.rotation.y += delta * 0.08
      group.rotation.x = Math.sin(timer.getElapsed() * 0.15) * 0.08 + smoothedScroll * 0.5
      group.rotation.z = smoothedScroll * 0.4
      camera.position.z = 7.2 - smoothedScroll * 1.3

      for (const pulse of pulses) {
        pulse.t += delta * pulse.speed
        if (pulse.t > 1) {
          pulse.t = 0
          pulse.edge = edges[Math.floor(Math.random() * edges.length)]
        }
        const [a, b] = pulse.edge
        pulse.mesh.position.lerpVectors(points[a], points[b], pulse.t)
        const mat = pulse.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = Math.sin(pulse.t * Math.PI)
      }

      renderer.render(scene, camera)
    }
    animate()
  }

  onBeforeUnmount(() => {
    cancelAnimationFrame(frameId)
    resizeObserver?.disconnect()
    observer?.disconnect()
    scrollTrigger?.kill()
    nodeGeometry.dispose()
    edgeGeometry.dispose()
    pulseGeometry.dispose()
    renderer?.dispose()
    renderer?.domElement.remove()
  })
})
</script>

<template>
  <div ref="canvasHost" class="mesh-scene h-full w-full" role="presentation" aria-hidden="true" />
</template>

<style scoped>
.mesh-scene :deep(canvas) {
  display: block;
}
</style>
