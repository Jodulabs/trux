// An async-generator-backed queue: producers push() messages, the SDK consumes
// them via iterable(). Backs the streaming-input prompt of a long-lived query().
export class PushQueue<T> {
  private items: T[] = []
  private waiters: ((r: IteratorResult<T>) => void)[] = []
  private done = false

  push(item: T): void {
    if (this.done) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: item, done: false })
    else this.items.push(item)
  }

  end(): void {
    this.done = true
    let waiter: ((r: IteratorResult<T>) => void) | undefined
    while ((waiter = this.waiters.shift())) waiter({ value: undefined as never, done: true })
  }

  async *iterable(): AsyncGenerator<T> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift() as T
        continue
      }
      if (this.done) return
      const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve))
      if (result.done) return
      yield result.value
    }
  }
}
