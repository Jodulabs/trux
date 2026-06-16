import { describe, expect, it } from 'vitest'
import { PushQueue } from '../../src/adapter/queue'

describe('PushQueue', () => {
  it('yields items pushed before iteration', async () => {
    const q = new PushQueue<number>()
    q.push(1)
    q.push(2)
    q.end()
    const seen: number[] = []
    for await (const n of q.iterable()) seen.push(n)
    expect(seen).toEqual([1, 2])
  })

  it('awaits items pushed after iteration starts', async () => {
    const q = new PushQueue<number>()
    const seen: number[] = []
    const consumer = (async () => {
      for await (const n of q.iterable()) {
        seen.push(n)
        if (seen.length === 2) q.end()
      }
    })()
    q.push(10)
    await Promise.resolve()
    q.push(20)
    await consumer
    expect(seen).toEqual([10, 20])
  })
})
