import { LocalVisionCapture } from '@proj-airi/local-vision/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const source = { session_binding_id: 'binding', source_id: 'camera', epoch: 1, privacy_generation: 1 }

describe('local vision camera lifecycle', () => {
  afterEach(() => vi.restoreAllMocks())

  it('releases a late binding without requesting camera access after stop', async () => {
    let resolveBinding!: (response: Response) => void
    const fetch = vi.spyOn(window, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'DELETE')
        return Response.json({ stopped: true })
      return new Promise<Response>((resolve) => {
        resolveBinding = resolve
      })
    })
    const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
    const client = new LocalVisionCapture(vi.fn(), vi.fn())
    const starting = client.start('session:card')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    client.stop()
    resolveBinding(Response.json(source))
    await starting
    expect(media).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/api/local-vision/bindings/binding', expect.objectContaining({ method: 'DELETE' }))
    expect(client.source).toBeUndefined()
  })

  it('stops every track when camera permission resolves after cancellation', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(Response.json(source))
    let resolveMedia!: (stream: MediaStream) => void
    const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(() => new Promise((resolve) => {
      resolveMedia = resolve
    }))
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const stream = canvas.captureStream(1)
    const client = new LocalVisionCapture(vi.fn(), vi.fn())
    const starting = client.start('session:card')
    await vi.waitFor(() => expect(media).toHaveBeenCalledOnce())
    client.stop()
    resolveMedia(stream)
    await starting
    expect(stream.getTracks().every(track => track.readyState === 'ended')).toBe(true)
    await expect(client.snapshot()).rejects.toThrow('No current camera frame')
  })

  it('rejects malformed ownership before camera access', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(Response.json({ session_binding_id: 'partial' }))
    const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
    const client = new LocalVisionCapture(vi.fn(), vi.fn())
    await expect(client.start('session:card')).rejects.toThrow()
    expect(media).not.toHaveBeenCalled()
    client.stop()
  })
})
